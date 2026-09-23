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
import { readDeclarative, createDeclarativeController } from './src/declarative-config.js';
import { readAuthPolicies, createAppAuth } from './src/app-auth.js';
import { createResilience, loadFallbacks } from './src/resilience.js';
import { canonicalOrigin } from './src/setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Keep startup synchronous to the module loader; initialize the selected store inside main().
// Some cPanel/Passenger Node loaders use require(), which rejects top-level await.
async function main() {
const config = loadConfig();
const saved = !config.declarativeEnabled ? readOperatorSettings(config) : null;
if (saved) {
  Object.assign(config, saved);
  config.setupSource = 'operator-file';
}
const validation = validateConfig(config);
if (!validation.valid) throw new Error(`Invalid AnchorWeight configuration: ${validation.errors.join('; ')}`);
for (const warning of validation.warnings) console.warn(`[AnchorWeight] WARNING: ${warning}`);
// Opt-in config must parse and validate before opening the public listener.
const unified = config.declarativeEnabled ? readDeclarative(config) : null;
if (unified) {
  config.originUrl=unified.originUrl;
  config.proxyEnabled=unified.proxyEnabled;
  config.setupSource='declarative-file';
}
let routes = unified ? unified.routes : loadRoutes(config);
config.activeRoutes=routes;
let routeStatus = routeSummary(routes,config.routesEnabled || config.declarativeEnabled);
const store = await createStore(config);
const telemetry = createTrafficTelemetry();
const gateway = createGatewayPolicy(config);
// Load credentials once, before opening the listener. A broken enabled policy must fail startup.
const applicationAuth = createAppAuth(readAuthPolicies(config));
const health = createUpstreamHealth(config);
// Each origin has an independent breaker; fallback choices are loaded only from a
// private, operator-approved file. Never derive destinations from request headers.
const configuredOrigins = [config.originUrl,...routes.map(r=>r.origin)];
// New resilience requires root-only canonical destinations. Do not tighten the
// legacy proxy URL rules for installations that leave resilience disabled.
if (config.resilienceEnabled) configuredOrigins.forEach(canonicalOrigin);
const fallbacks = loadFallbacks(config, configuredOrigins);
const resilience = createResilience(config,{fallbacks});
const contexts = new WeakMap();
function makeProxy(settings, {stripCredentials=false} = {}) {
  const origin = settings.originUrl;
  return createReverseProxy({ ...config, originUrl:settings.originUrl }, {
    stripCredentials,
    onUpstreamStart:req=>contexts.get(req)?.upstreamStart(),
    onUpstreamResponse:(req,status)=>{
      contexts.get(req)?.upstreamResponse(status);
      resilience.response(origin,status);
    },
    onUpstreamEnd:req=>contexts.get(req)?.upstreamEnd(),
    onUpstreamFailure:req=>contexts.get(req)?.upstreamFailure(),
    onProxyError:err=>{
      resilience.failure(origin);
      console.error('[AnchorWeight] origin:',err.message);
    },
    onMaintenance:(req,res)=>maintenanceResponse(req,res,{title:config.gatewayMaintenanceTitle,message:config.gatewayMaintenanceMessage})
  });
}
function prepareDefault(settings){
  const candidateRoutes = settings.routes || routes;
  const candidateProxies = new Map(candidateRoutes.map(route=>[route.origin,makeProxy({originUrl:route.origin})]));
  const fallback=makeProxy(settings);
  // Build only already-validated fallback proxies. A request never supplies an origin.
  const alternateProxies=new Map([...fallbacks.values()].map(origin=>
    [origin,makeProxy({originUrl:origin},{stripCredentials:true})]));
  return (req,res)=>{
    const pathname=new URL(req.url,'http://anchorweight.local').pathname;
    if((candidateRoutes.length || config.appAuthEnabled) && (unsafeRoutePath(pathname)||unsafeRoutePath(String(req.url||'').split('?')[0])||!String(req.url||'').startsWith('/'))){
      return send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'ambiguous_route_path'}),{'Cache-Control':'no-store'});
    }
    const route=routeForPath(candidateRoutes,pathname);
    const primary=new URL(route?.origin || settings.originUrl).href;
    const selected=resilience.choose(primary,req);
    if (selected===null) {
      // Unsafe methods are never replayed or rerouted to a fallback origin.
      return maintenanceResponse(req,res,{title:config.gatewayMaintenanceTitle,message:config.gatewayMaintenanceMessage});
    }
    return (selected===primary ? (route?candidateProxies.get(route.origin):fallback)
      : alternateProxies.get(selected))(req,res);
  };
}
let activeProxy = config.proxyEnabled ? prepareDefault(config) : null;
const setupFactory = config.declarativeEnabled ? createDeclarativeController : createSetupController;
const setup = setupFactory(config, { onActivate:settings => {
  const nextProxy = settings.proxyEnabled ? prepareDefault(settings) : null;
  return () => {
    config.originUrl=settings.originUrl;
    config.proxyEnabled=settings.proxyEnabled;
    if (settings.routes) {
      routes=settings.routes;
      config.activeRoutes=routes;
      routeStatus=routeSummary(routes,true);
    }
    activeProxy=nextProxy;
    health.probe().catch(err=>console.error('[AnchorWeight] health probe:',err.message));
    // The resilience pool reads config.activeRoutes/originUrl on each snapshot.
    // Changed live routing cannot continue using stale origin health state.
  };
} });
const aw = createAnchorWeight(config, { store, telemetry, setup, gateway, applicationAuth, health, resilience, routing:()=>routeStatus });
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
        ok: true, service: 'AnchorWeight', version: '2.3.0', routesEnabled:config.routesEnabled || config.declarativeEnabled, routeCount:routes.length,
        shadowMode: config.shadowMode, proxyEnabled: config.proxyEnabled,
        basePath: config.basePath, blockDepth: config.blockDepth
      }), { 'Cache-Control':'no-store' });
    }
    if (url.pathname === '/ready') {
      const origin = await checkOriginReady();
      const ok = origin.ok;
      return send(res, ok ? 200 : 503, 'application/json; charset=utf-8', JSON.stringify({
        ok, service:'AnchorWeight', version:'2.3.0', stateLoaded:true, stateBackend: config.stateBackend,
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
      if((routes.length || config.appAuthEnabled) && (unsafeRoutePath(url.pathname)||unsafeRoutePath(String(req.url||'').split('?')[0])||!String(req.url||'').startsWith('/')))
        return send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'ambiguous_route_path'}),{'Cache-Control':'no-store'});
      const policy=gateway.check(req,url.pathname);
      if (policy.action!=='pass') {
        if(policy.retryAfter)res.setHeader('Retry-After',String(policy.retryAfter));
        return send(res,policy.action==='deny'?403:429,'application/json; charset=utf-8',
          JSON.stringify({error:policy.reason}),{'Cache-Control':'no-store'});
      }
      // Bot DNA, local operator APIs and gateway access checks run independently.
      const auth=await applicationAuth.check(req,url.pathname);
      if(auth.action==='busy') return send(res,429,'application/json; charset=utf-8',
        JSON.stringify({error:'authentication_busy'}),{'Retry-After':'1','Cache-Control':'no-store'});
      if(auth.action==='challenge') return send(res,401,'application/json; charset=utf-8',
        JSON.stringify({error:'application_authentication_required'}),{
          ...(auth.mode==='basic'?{'WWW-Authenticate':'Basic realm="AnchorWeight protected origin", charset="UTF-8"'}:{}),
          'Cache-Control':'no-store'
        });
      context.markProxied();
      return activeProxy(req,res);
    }

    if (url.pathname === '/') {
      return send(res, 200, 'text/html; charset=utf-8', '<!doctype html><html><head><meta charset="utf-8"><title>AnchorWeight</title></head><body><h1>AnchorWeight v2.3.0</h1><p>Reverse proxy is disabled. Configure AW_ORIGIN_URL and set AW_PROXY_ENABLED=true to protect an entire site.</p><p><a href="/dashboard.html">Dashboard</a> · <a href="/setup.html">Setup wizard</a> · <a href="/health">Health</a></p></body></html>');
    }
    return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal_error' }));
    res.end();
  }
});

health.start();
resilience.start();
server.listen(config.port, () => {
  console.log(`AnchorWeight v2.3.0 listening on :${config.port}`);
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
  resilience.stop();
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
