import http from 'node:http';
import https from 'node:https';
import { Transform } from 'node:stream';

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
    const target = new URL(incoming.pathname + incoming.search, origin);
    const headers = filteredHeaders(req.headers);
    headers.host = origin.host;

    const ip = clientIp(req, config.trustProxy);
    if (ip) {
      const existing = typeof headers['x-forwarded-for'] === 'string' ? headers['x-forwarded-for'] : '';
      headers['x-forwarded-for'] = config.trustProxy && existing ? existing : ip;
    }
    headers['x-forwarded-host'] = String(req.headers.host || '');
    headers['x-forwarded-proto'] = config.publicScheme;

    const upstream = transport.request(target, {
      method: req.method,
      headers,
      timeout: config.proxyTimeoutMs,
      agent: deps.agent
    }, upstreamRes => {
      const responseHeaders = filteredHeaders(upstreamRes.headers);
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      upstreamRes.pipe(res);
    });

    upstream.on('timeout', () => upstream.destroy(new Error('origin_timeout')));
    upstream.on('error', err => {
      deps.onProxyError?.(err);
      if (!res.headersSent) {
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
