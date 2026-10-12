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

function headerPresent(value) {
  if (Array.isArray(value)) return value.some(v => typeof v === 'string' && v.trim());
  return typeof value === 'string' && !!value.trim();
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

function requestDiagnostics(req) {
  const remote=normalizedIp(req?.socket?.remoteAddress || '');
  const rawForwarded=req?.headers?.['x-forwarded-for'];
  const forwardedForPresent=headerPresent(rawForwarded);
  const forwarded=firstForwarded(rawForwarded);
  const proxyHints=!!(req?.headers?.['x-forwarded-proto'] || req?.headers?.['x-forwarded-host']);
  const internalHop=internalProxyHop(remote);
  return {
    proxyHints,
    internalProxyHop:internalHop,
    forwardedForPresent,
    forwardedForValid:!!forwarded,
    forwardedForInvalid:forwardedForPresent && !forwarded,
    forwarded
  };
}

function diagnosticVerdict({enforcementSafe,reason},config={}) {
  if (enforcementSafe) return {
    verdict:'trusted_client_identity',
    remediationCode:'none',
    requiresHostingChange:false,
    operatorAction:'Client identity is trusted; keep the proxy trust boundary and forwarding configuration unchanged.'
  };
  if (reason==='trusted_proxy_client_ip_unavailable') return {
    verdict:'trusted_proxy_missing_client_ip',
    remediationCode:'hosting_proxy_must_supply_sanitized_x_forwarded_for',
    requiresHostingChange:true,
    operatorAction:'Trusted proxy mode is enabled, but no client IP is arriving. Ask the hosting proxy to overwrite client-supplied X-Forwarded-For and pass a server-generated original client IP.'
  };
  if (reason==='trusted_proxy_client_ip_invalid') return {
    verdict:'trusted_proxy_invalid_client_ip',
    remediationCode:'hosting_proxy_forwarded_for_invalid',
    requiresHostingChange:true,
    operatorAction:'Trusted proxy mode is enabled, but X-Forwarded-For is not a usable IP address. Ask the hosting proxy to supply a sanitized valid client IP.'
  };
  if (reason==='proxy_client_ip_unavailable') return {
    verdict:'proxy_detected_trust_disabled',
    remediationCode:'verify_sanitized_forwarding_before_enabling_trust',
    requiresHostingChange:true,
    operatorAction:'A local proxy is detected but forwarded client identity is not trusted. Verify that the hosting proxy overwrites X-Forwarded-For before enabling AW_TRUST_PROXY.'
  };
  if (reason==='client_ip_unavailable') return {
    verdict:'client_ip_unavailable',
    remediationCode:'inspect_network_handoff',
    requiresHostingChange:true,
    operatorAction:'No usable client address reached Node. Inspect the web-server/Passenger handoff before enabling client-scoped enforcement.'
  };
  return {
    verdict:config.trustProxy?'trusted_proxy_identity_degraded':'client_identity_degraded',
    remediationCode:'inspect_client_identity',
    requiresHostingChange:false,
    operatorAction:'Inspect /live clientIdentity diagnostics and keep client-scoped enforcement disabled until identity becomes trusted.'
  };
}

export function resolveClientIdentity(req, config={}) {
  const d=requestDiagnostics(req);
  const remote=normalizedIp(req?.socket?.remoteAddress || '');
  const proxyDetected=d.internalProxyHop && d.proxyHints;

  if (config.trustProxy) {
    if (d.forwarded) return {
      ip:d.forwarded,source:'x-forwarded-for',status:'trusted',reason:null,enforcementSafe:true,proxyDetected:true,
      diagnostics:{proxyHints:d.proxyHints,internalProxyHop:d.internalProxyHop,forwardedForPresent:d.forwardedForPresent,forwardedForValid:true,forwardedForInvalid:false}
    };
    return {
      ip:null, source:'none', status:'degraded', enforcementSafe:false, proxyDetected:true,
      reason:d.forwardedForPresent ? 'trusted_proxy_client_ip_invalid' : 'trusted_proxy_client_ip_unavailable',
      diagnostics:{proxyHints:d.proxyHints,internalProxyHop:d.internalProxyHop,forwardedForPresent:d.forwardedForPresent,forwardedForValid:false,forwardedForInvalid:d.forwardedForInvalid}
    };
  }

  if (!remote) return {
    ip:null,source:'none',status:'degraded',reason:'client_ip_unavailable',enforcementSafe:false,proxyDetected,
    diagnostics:{proxyHints:d.proxyHints,internalProxyHop:d.internalProxyHop,forwardedForPresent:d.forwardedForPresent,forwardedForValid:d.forwardedForValid,forwardedForInvalid:d.forwardedForInvalid}
  };
  if (config.proxyEnabled && proxyDetected) {
    return {
      ip:null,source:'none',status:'degraded',reason:'proxy_client_ip_unavailable',enforcementSafe:false,proxyDetected:true,
      diagnostics:{proxyHints:d.proxyHints,internalProxyHop:d.internalProxyHop,forwardedForPresent:d.forwardedForPresent,forwardedForValid:d.forwardedForValid,forwardedForInvalid:d.forwardedForInvalid}
    };
  }
  return {
    ip:remote,source:'socket',status:'trusted',reason:null,enforcementSafe:true,proxyDetected:false,
    diagnostics:{proxyHints:d.proxyHints,internalProxyHop:d.internalProxyHop,forwardedForPresent:d.forwardedForPresent,forwardedForValid:d.forwardedForValid,forwardedForInvalid:d.forwardedForInvalid}
  };
}

export function createClientIdentityMonitor(config,{now=()=>Date.now(),onDegraded=()=>{}}={}) {
  const seen=new WeakSet();
  const state={
    observations:0,trustedObservations:0,degradedObservations:0,lastObservedAt:null,lastSource:null,lastReason:null,
    lastDegradedReason:null,proxyDetected:false,proxyHintObservations:0,internalProxyHopObservations:0,
    forwardedForObservations:0,forwardedForValidObservations:0,forwardedForInvalidObservations:0,
    missingForwardedForWhileTrustedProxy:0
  };
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
      const d=identity.diagnostics || {};
      if (d.proxyHints) state.proxyHintObservations++;
      if (d.internalProxyHop) state.internalProxyHopObservations++;
      if (d.forwardedForPresent) state.forwardedForObservations++;
      if (d.forwardedForValid) state.forwardedForValidObservations++;
      if (d.forwardedForInvalid) state.forwardedForInvalidObservations++;
      if (config.trustProxy && !d.forwardedForPresent) state.missingForwardedForWhileTrustedProxy++;
      if (identity.enforcementSafe) state.trustedObservations++;
      else {
        state.degradedObservations++;
        state.lastDegradedReason=identity.reason || state.lastDegradedReason;
        if (!warned) { warned=true; onDegraded(identity); }
      }
    }
    return identity;
  }
  function snapshot() {
    const degraded=state.degradedObservations>0;
    const status=degraded?'degraded':(state.trustedObservations>0?'trusted':'unknown');
    const reason=degraded?(state.lastReason || state.lastDegradedReason || 'client_identity_degraded'):null;
    const enforcementSafe=!degraded && state.trustedObservations>0;
    const guidance=diagnosticVerdict({enforcementSafe,reason},config);
    return {
      status,
      reason,
      source:degraded?'none':state.lastSource,
      enforcementSafe,
      trustProxy:!!config.trustProxy,
      proxyDetected:state.proxyDetected,
      observations:state.observations,
      trustedObservations:state.trustedObservations,
      degradedObservations:state.degradedObservations,
      lastObservedAt:state.lastObservedAt,
      diagnostics:{
        version:1,
        ...guidance,
        proxyHintsObserved:state.proxyHintObservations>0,
        internalProxyHopObserved:state.internalProxyHopObservations>0,
        forwardedForObserved:state.forwardedForObservations>0,
        forwardedForObservations:state.forwardedForObservations,
        forwardedForValidObservations:state.forwardedForValidObservations,
        forwardedForInvalidObservations:state.forwardedForInvalidObservations,
        missingForwardedForWhileTrustedProxy:state.missingForwardedForWhileTrustedProxy,
        rawClientIpExposed:false,
        rawForwardedHeaderExposed:false
      }
    };
  }
  return {observe,snapshot};
}

export function sessionIdentityKey(secret,sid) {
  return crypto.createHmac('sha256',secret).update('session-only\0'+String(sid || '')).digest('base64url').slice(0,20);
}
