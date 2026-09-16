import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnchorWeight } from './src/anchorweight.js';
import { loadConfig } from './src/config.js';
import { PersistentStore } from './src/persistent-store.js';
import { createReverseProxy } from './src/proxy.js';
import { validateConfig } from './src/config-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const validation = validateConfig(config);
if (!validation.valid) throw new Error(`Invalid AnchorWeight configuration: ${validation.errors.join('; ')}`);
for (const warning of validation.warnings) console.warn(`[AnchorWeight] WARNING: ${warning}`);
const store = new PersistentStore(config.stateFile);
const aw = createAnchorWeight(config, { store });
const dashboard = fs.readFileSync(path.join(__dirname, 'public', 'dashboard.html'), 'utf8')
  .replaceAll('__AW_BASE_PATH__', config.basePath);
const proxy = config.proxyEnabled ? createReverseProxy(config, { onProxyError: err => console.error('[AnchorWeight] origin:', err.message) }) : null;

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...headers
  });
  res.end(body);
}

function checkOriginReady() {
  if (!config.proxyEnabled || !config.readinessOriginCheck) return Promise.resolve({ok:true, detail:'origin check skipped'});
  return new Promise(resolve => {
    let origin;
    try { origin = new URL(config.originUrl); } catch { return resolve({ok:false, detail:'invalid origin URL'}); }
    const transport = origin.protocol === 'https:' ? https : http;
    const req = transport.request(origin, { method:'HEAD', timeout:Math.min(config.proxyTimeoutMs, 3000) }, res => {
      res.resume();
      resolve({ok:(res.statusCode || 500) < 600, detail:`HTTP ${res.statusCode || 0}`});
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', err => resolve({ok:false, detail:err.message}));
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Operational endpoints are handled before quarantine/proxy routing.
    if (url.pathname === '/live' || url.pathname === '/health') {
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
        ok: true, service: 'AnchorWeight', version: '1.1.0',
        shadowMode: config.shadowMode, proxyEnabled: config.proxyEnabled,
        basePath: config.basePath, blockDepth: config.blockDepth
      }), { 'Cache-Control':'no-store' });
    }
    if (url.pathname === '/ready') {
      const origin = await checkOriginReady();
      const ok = origin.ok;
      return send(res, ok ? 200 : 503, 'application/json; charset=utf-8', JSON.stringify({
        ok, service:'AnchorWeight', version:'1.1.0', stateLoaded:true,
        stateVersion:store.loadedStateVersion || null,
        migrationsApplied:store.migrationsApplied || [],
        proxyEnabled:config.proxyEnabled, origin
      }), { 'Cache-Control':'no-store' });
    }
    if (url.pathname === '/dashboard.html' && config.dashboardEnabled) {
      return send(res, 200, 'text/html; charset=utf-8', dashboard, {
        'Cache-Control':'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
      });
    }

    // Operational trap/API requests are handled before quarantine so authorized operators can investigate.
    if (url.pathname === config.basePath || url.pathname.startsWith(`${config.basePath}/api/`)) {
      return aw.handle(req, res, url);
    }

    // A convicted client sees decoys before it can reach the trap or the real origin.
    if (await aw.preflight(req, res, url)) return;

    if (url.pathname.startsWith(`${config.basePath}/`)) {
      return aw.handle(req, res, url);
    }

    if (proxy) return proxy(req, res);

    if (url.pathname === '/') {
      return send(res, 200, 'text/html; charset=utf-8', '<!doctype html><html><head><meta charset="utf-8"><title>AnchorWeight</title></head><body><h1>AnchorWeight v1.1.0</h1><p>Reverse proxy is disabled. Configure AW_ORIGIN_URL and set AW_PROXY_ENABLED=true to protect an entire site.</p><p><a href="/dashboard.html">Dashboard</a> · <a href="/health">Health</a></p></body></html>');
    }
    return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal_error' }));
    res.end();
  }
});

server.listen(config.port, () => {
  console.log(`AnchorWeight v1.1.0 listening on :${config.port}`);
  console.log(`Trap path: ${config.basePath}`);
  console.log(`Mode: ${config.shadowMode ? 'SHADOW (no quarantine)' : 'ENFORCE'}`);
  console.log(`Reverse proxy: ${config.proxyEnabled ? `ON -> ${config.originUrl}` : 'OFF'}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[AnchorWeight] ${signal}: graceful shutdown started`);
  try { store.flush?.(); } catch (err) { console.error('[AnchorWeight] state flush:', err.message); }
  const timer = setTimeout(() => {
    console.error('[AnchorWeight] graceful shutdown timed out');
    process.exit(1);
  }, config.shutdownGraceMs);
  timer.unref();
  server.close(() => {
    clearTimeout(timer);
    try { store.flush?.(); } catch {}
    console.log('[AnchorWeight] graceful shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
