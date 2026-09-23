import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnchorWeight } from './src/anchorweight.js';
import { loadConfig } from './src/config.js';
import { createStore } from './src/create-store.js';
import { createReverseProxy } from './src/proxy.js';
import { validateConfig } from './src/config-schema.js';
import { createTrafficTelemetry } from './src/telemetry.js';
import { createSetupController, readOperatorSettings } from './src/setup.js';
import { createGatewayPolicy } from './src/gateway-policy.js';
import { createUpstreamHealth, maintenanceResponse } from './src/upstream-health.js';
import { loadRoutes, routeForPath, unsafeRoutePath, routeSummary } from './src/routing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Keep startup synchronous to the module loader; initialize the selected store inside main().
// Some cPanel/Passenger Node loaders use require(), which rejects top-level await.
async function main() {
const config = loadConfig();
const saved = readOperatorSettings(config);
if (saved) {
  Object.assign(config, saved);
  config.setupSource = 'operator-file';
}
const validation = validateConfig(config);
if (!validation.valid) throw new Error(`Invalid AnchorWeight configuration: ${validation.errors.join('; ')}`);
for (const warning of validation.warnings) console.warn(`[AnchorWeight] WARNING: ${warning}`);
const routes = loadRoutes(config); // Fail before binding if an explicitly enabled route file is invalid.
const routeStatus = routeSummary(routes,config.routesEnabled);
const store = await createStore(config);
const telemetry = createTrafficTelemetry();
const gateway = createGatewayPolicy(config);
const health = createUpstreamHealth(config);
const contexts = new WeakMap();
function makeProxy(settings) {
  return createReverseProxy({ ...config, originUrl:settings.originUrl }, {
    onUpstreamStart:req=>contexts.get(req)?.upstreamStart(),
    onUpstreamResponse:(req,status)=>contexts.get(req)?.upstreamResponse(status),
    onUpstreamEnd:req=>contexts.get(req)?.upstreamEnd(),
    onUpstreamFailure:req=>contexts.get(req)?.upstreamFailure(),
    onProxyError:err=>console.error('[AnchorWeight] origin:',err.message),
    onMaintenance:(req,res)=>maintenanceResponse(req,res,{title:config.gatewayMaintenanceTitle,message:config.gatewayMaintenanceMessage})
  });
}
const routeProxies = new Map(routes.map(route=>[route.origin,makeProxy({originUrl:route.origin})]));
function prepareDefault(settings){
  const fallback=makeProxy(settings);
  return (req,res)=>{
    const pathname=new URL(req.url,'http://anchorweight.local').pathname;
    if(routes.length && (unsafeRoutePath(pathname)||unsafeRoutePath(String(req.url||'').split('?')[0])||!String(req.url||'').startsWith('/'))){
      return send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'ambiguous_route_path'}),{'Cache-Control':'no-store'});
    }
    const route=routeForPath(routes,pathname);
    return (route?routeProxies.get(route.origin):fallback)(req,res);
  };
}
let activeProxy = config.proxyEnabled ? prepareDefault(config) : null;
const setup = createSetupController(config, { onActivate:settings => {
  const nextProxy = settings.proxyEnabled ? prepareDefault(settings) : null;
  return () => {
    config.originUrl=settings.originUrl;
    config.proxyEnabled=settings.proxyEnabled;
    activeProxy=nextProxy;
    health.probe().catch(err=>console.error('[AnchorWeight] health probe:',err.message));
  };
} });
const aw = createAnchorWeight(config, { store, telemetry, setup, gateway, health, routing:routeStatus });
const dashboard = fs.readFileSync(path.join(__dirname, 'public', 'dashboard.html'), 'utf8')
  .replaceAll('__AW_BASE_PATH__', config.basePath);
const setupPage = fs.readFileSync(path.join(__dirname,'public','setup.html'),'utf8');

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

async function checkOriginReady() {
  if (!config.proxyEnabled || !config.readinessOriginCheck)
    return {ok:true,detail:'origin check skipped',routes:[]};
  async function probe(value) {
    return new Promise(resolve => {
      let origin;
      try {origin = new URL(value);}catch{return resolve({ok:false,detail:'invalid origin URL'});}
      const transport=origin.protocol==='https:'?https:http;
      const req=transport.request(origin,{method:'HEAD',timeout:Math.min(config.proxyTimeoutMs,3000)},upstream=>{
        upstream.resume();resolve({ok:(upstream.statusCode||500)<500,detail:`HTTP ${upstream.statusCode||0}`});
      });
      req.once('timeout',()=>req.destroy(new Error('timeout')));
      req.once('error',()=>resolve({ok:false,detail:'connection failed'}));
      req.end();
    });
  }
  const result=await probe(config.originUrl);
  const perRoute=await Promise.all(routes.map(async route=>({path:route.path,...await probe(route.origin)})));
  return {...result,ok:result.ok&&perRoute.every(r=>r.ok),routes:perRoute};
}

const server = http.createServer(async (req, res) => {
  const context = telemetry.begin(req,res);
  contexts.set(req,context);
  res.once('close',()=>contexts.delete(req));
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Operational endpoints are handled before quarantine/proxy routing.
    if (url.pathname === '/live' || url.pathname === '/health') {
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
        ok: true, service: 'AnchorWeight', version: '2.0.0', routesEnabled:config.routesEnabled, routeCount:routes.length,
        shadowMode: config.shadowMode, proxyEnabled: config.proxyEnabled,
        basePath: config.basePath, blockDepth: config.blockDepth
      }), { 'Cache-Control':'no-store' });
    }
    if (url.pathname === '/ready') {
      const origin = await checkOriginReady();
      const ok = origin.ok;
      return send(res, ok ? 200 : 503, 'application/json; charset=utf-8', JSON.stringify({
        ok, service:'AnchorWeight', version:'2.0.0', stateLoaded:true, stateBackend: config.stateBackend,
        stateVersion:store.loadedStateVersion || null,
        migrationsApplied:store.migrationsApplied || [],
        proxyEnabled:config.proxyEnabled, origin, routing:routeStatus
      }), { 'Cache-Control':'no-store' });
    }
    if (url.pathname === '/setup.html' && config.dashboardEnabled && req.method === 'GET') {
      return send(res, 200, 'text/html; charset=utf-8', setupPage, {
        'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow',
        'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
      });
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

    if (activeProxy) {
      if(routes.length && (unsafeRoutePath(url.pathname)||unsafeRoutePath(String(req.url||'').split('?')[0])||!String(req.url||'').startsWith('/')))
        return send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'ambiguous_route_path'}),{'Cache-Control':'no-store'});
      const policy=gateway.check(req,url.pathname);
      if (policy.action!=='pass') {
        if(policy.retryAfter)res.setHeader('Retry-After',String(policy.retryAfter));
        return send(res,policy.action==='deny'?403:429,'application/json; charset=utf-8',
          JSON.stringify({error:policy.reason}),{'Cache-Control':'no-store'});
      }
      context.markProxied();
      return activeProxy(req,res);
    }

    if (url.pathname === '/') {
      return send(res, 200, 'text/html; charset=utf-8', '<!doctype html><html><head><meta charset="utf-8"><title>AnchorWeight</title></head><body><h1>AnchorWeight v2.0.0</h1><p>Reverse proxy is disabled. Configure AW_ORIGIN_URL and set AW_PROXY_ENABLED=true to protect an entire site.</p><p><a href="/dashboard.html">Dashboard</a> · <a href="/setup.html">Setup wizard</a> · <a href="/health">Health</a></p></body></html>');
    }
    return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal_error' }));
    res.end();
  }
});

health.start();
server.listen(config.port, () => {
  console.log(`AnchorWeight v2.0.0 listening on :${config.port}`);
  console.log(`Trap path: ${config.basePath}`);
  console.log(`State backend: ${config.stateBackend}`);
  console.log(`Mode: ${config.shadowMode ? 'SHADOW (no quarantine)' : 'ENFORCE'}`);
  console.log(`Reverse proxy: ${config.proxyEnabled ? `ON -> ${config.originUrl}` : 'OFF'}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[AnchorWeight] ${signal}: graceful shutdown started`);
  health.stop();
  try { store.flush?.(); } catch (err) { console.error('[AnchorWeight] state flush:', err.message); }
  const timer = setTimeout(() => {
    console.error('[AnchorWeight] graceful shutdown timed out');
    process.exit(1);
  }, config.shutdownGraceMs);
  timer.unref();
  server.close(() => {
    clearTimeout(timer);
    aw.publisher.stop();
    try { if (store.close) store.close(); else store.flush?.(); } catch (err) { console.error('[AnchorWeight] state close:', err.message); }
    console.log('[AnchorWeight] graceful shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

}

main().catch(err => {
  console.error('[AnchorWeight] startup failed:', err);
  process.exitCode = 1;
});
