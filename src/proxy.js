import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';
import { rewriteOriginResponse, shouldRewriteOriginResponse } from './blackhole.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'
]);

function filteredHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (value == null || HOP_BY_HOP.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

export function createReverseProxy(config, deps = {}) {
  const origin = new URL(config.originUrl);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('AW_ORIGIN_URL must use http:// or https://');
  if (origin.username || origin.password) throw new Error('AW_ORIGIN_URL must not contain credentials');
  if (origin.hash || origin.search) throw new Error('AW_ORIGIN_URL must not contain query strings or fragments');
  const transport = origin.protocol === 'https:' ? https : http;

  return function proxy(req, res) {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared && declared > config.proxyBodyMaxBytes) {
      res.writeHead(413, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
      res.end('Payload too large');
      return;
    }
    const incoming = new URL(req.url, 'http://anchorweight.local');
    // Never resolve request-target as a URL: leading // could replace the approved origin host.
    const target = new URL(origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = filteredHeaders(req.headers);
    // Fallbacks are operator-approved but may be separate services. Never
    // forward application credentials to an alternate origin. Ordinary primary
    // proxy traffic retains Authorization, unless app-auth removed it already.
    if (deps.stripCredentials) {
      delete headers.authorization;
      delete headers['x-api-key'];
    }
    headers.host = origin.host;
    if (config.blackholeEnabled) headers['accept-encoding'] = 'identity';

    const ip = clientIp(req, config.trustProxy);
    if (ip) {
      const existing = typeof headers['x-forwarded-for'] === 'string' ? headers['x-forwarded-for'] : '';
      headers['x-forwarded-for'] = config.trustProxy && existing ? existing : ip;
    }
    headers['x-forwarded-host'] = String(req.headers.host || '');
    headers['x-forwarded-proto'] = config.publicScheme;

    deps.onUpstreamStart?.(req);
    const upstream = transport.request(target, {
      method: req.method,
      headers,
      timeout: config.proxyTimeoutMs,
      agent: deps.agent
    }, upstreamRes => {
      let upstreamEnded=false;
      upstreamRes.once('end',()=>{upstreamEnded=true;deps.onUpstreamEnd?.(req);});
      upstreamRes.once('close',()=>{if(upstreamEnded)deps.onUpstreamEnd?.(req);else deps.onUpstreamFailure?.(req);});
      const statusCode = upstreamRes.statusCode || 502;
      deps.onUpstreamResponse?.(req,statusCode);
      const responseHeaders = filteredHeaders(upstreamRes.headers);
      const contentType = String(upstreamRes.headers['content-type'] || '');
      const contentEncoding = String(upstreamRes.headers['content-encoding'] || '');
      const rewrite = shouldRewriteOriginResponse({
        pathname: incoming.pathname,
        method: req.method,
        statusCode,
        contentType,
        contentEncoding,
        config
      });

      if (!rewrite) {
        res.writeHead(statusCode, responseHeaders);
        upstreamRes.pipe(res);
        return;
      }

      const chunks = [];
      let bytes = 0;
      let passthrough = false;
      const maxBytes = config.blackholeMaxResponseBytes || 2097152;

      upstreamRes.on('data', chunk => {
        if (passthrough) {
          res.write(chunk);
          return;
        }

        bytes += chunk.length;
        if (bytes > maxBytes) {
          passthrough = true;
          res.writeHead(statusCode, responseHeaders);
          for (const queued of chunks) res.write(queued);
          res.write(chunk);
          return;
        }
        chunks.push(chunk);
      });

      upstreamRes.on('end', () => {
        if (passthrough) {
          res.end();
          return;
        }

        const original = Buffer.concat(chunks).toString('utf8');
        const rewritten = rewriteOriginResponse(original, {
          pathname: incoming.pathname,
          contentType,
          config
        });
        const body = Buffer.from(rewritten, 'utf8');

        delete responseHeaders.etag;
        delete responseHeaders['content-md5'];
        delete responseHeaders.digest;
        responseHeaders['content-length'] = String(body.length);
        res.writeHead(statusCode, responseHeaders);
        res.end(body);
      });
    });

    upstream.on('timeout', () => upstream.destroy(new Error('origin_timeout')));
    upstream.on('error', err => {
      deps.onUpstreamFailure?.(req);
      deps.onProxyError?.(err,req);
      if (err.message === 'request_body_too_large') return; // Request limiter will send 413, never substitute maintenance.
      if (!res.headersSent && config.gatewayMaintenanceEnabled && ['GET','HEAD'].includes(req.method)) {
        deps.onMaintenance?.(req,res);
      } else if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Bad gateway');
      } else {
        res.destroy();
      }
    });

    let seen = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        if (seen > config.proxyBodyMaxBytes) return cb(new Error('request_body_too_large'));
        cb(null, chunk);
      }
    });
    limiter.on('error', err => {
      upstream.destroy(err);
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
        res.end('Payload too large');
      } else res.destroy();
    });
    req.pipe(limiter).pipe(upstream);
  };
}
