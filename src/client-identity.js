import net from 'node:net';
import crypto from 'node:crypto';

function normalizedIp(value) {
  let raw=String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('[') && raw.includes(']')) raw=raw.slice(1,raw.indexOf(']'));
  const zone=raw.indexOf('%');
  if (zone>=0) raw=raw.slice(0,zone);
  if (raw.toLowerCase().startsWith('::ffff:')) {
    const mapped=raw.slice(7);
    if (net.isIP(mapped)===4) return mapped;
  }
  return net.isIP(raw) ? raw : '';
}

function firstForwarded(value) {
  if (Array.isArray(value)) value=value[0];
  if (typeof value!=='string' || !value.trim()) return '';
  return normalizedIp(value.split(',')[0].trim());
}

function internalProxyHop(ip) {
  const value=normalizedIp(ip);
  const family=net.isIP(value);
  if (family===4) {
    const p=value.split('.').map(Number);
    if (p[0]===10 || p[0]===127) return true;
    if (p[0]===169 && p[1]===254) return true;
    if (p[0]===172 && p[1]>=16 && p[1]<=31) return true;
    if (p[0]===192 && p[1]===168) return true;
    if (p[0]===100 && p[1]>=64 && p[1]<=127) return true;
    return false;
  }
  if (family===6) {
    const lower=value.toLowerCase();
    return lower==='::1' || lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower);
  }
  return false;
}

export function resolveClientIdentity(req, config={}) {
  const remote=normalizedIp(req?.socket?.remoteAddress || '');
  const forwarded=firstForwarded(req?.headers?.['x-forwarded-for']);
  const proxyHints=!!(req?.headers?.['x-forwarded-proto'] || req?.headers?.['x-forwarded-host']);
  const proxyDetected=internalProxyHop(remote) && proxyHints;

  if (config.trustProxy) {
    if (forwarded) return {ip:forwarded,source:'x-forwarded-for',status:'trusted',reason:null,enforcementSafe:true,proxyDetected:true};
    return {
      ip:null, source:'none', status:'degraded', enforcementSafe:false, proxyDetected:true,
      reason:req?.headers?.['x-forwarded-for'] ? 'trusted_proxy_client_ip_invalid' : 'trusted_proxy_client_ip_unavailable'
    };
  }

  if (!remote) return {ip:null,source:'none',status:'degraded',reason:'client_ip_unavailable',enforcementSafe:false,proxyDetected};
  if (config.proxyEnabled && proxyDetected) {
    return {ip:null,source:'none',status:'degraded',reason:'proxy_client_ip_unavailable',enforcementSafe:false,proxyDetected:true};
  }
  return {ip:remote,source:'socket',status:'trusted',reason:null,enforcementSafe:true,proxyDetected:false};
}

export function createClientIdentityMonitor(config,{now=()=>Date.now(),onDegraded=()=>{}}={}) {
  const seen=new WeakSet();
  const state={observations:0,trustedObservations:0,degradedObservations:0,lastObservedAt:null,lastSource:null,lastReason:null,proxyDetected:false};
  let warned=false;
  function observe(req) {
    const identity=resolveClientIdentity(req,config);
    if (req && typeof req==='object' && !seen.has(req)) {
      seen.add(req);
      state.observations++;
      state.lastObservedAt=new Date(now()).toISOString();
      state.lastSource=identity.source;
      state.lastReason=identity.reason;
      state.proxyDetected=state.proxyDetected || identity.proxyDetected;
      if (identity.enforcementSafe) state.trustedObservations++;
      else {
        state.degradedObservations++;
        if (!warned) { warned=true; onDegraded(identity); }
      }
    }
    return identity;
  }
  function snapshot() {
    const degraded=state.degradedObservations>0;
    return {
      status:degraded?'degraded':(state.trustedObservations>0?'trusted':'unknown'),
      reason:degraded?(state.lastReason || 'client_identity_degraded'):null,
      source:degraded?'none':state.lastSource,
      enforcementSafe:!degraded && state.trustedObservations>0,
      trustProxy:!!config.trustProxy,
      proxyDetected:state.proxyDetected,
      observations:state.observations,
      trustedObservations:state.trustedObservations,
      degradedObservations:state.degradedObservations,
      lastObservedAt:state.lastObservedAt
    };
  }
  return {observe,snapshot};
}

export function sessionIdentityKey(secret,sid) {
  return crypto.createHmac('sha256',secret).update('session-only\0'+String(sid || '')).digest('base64url').slice(0,20);
}
