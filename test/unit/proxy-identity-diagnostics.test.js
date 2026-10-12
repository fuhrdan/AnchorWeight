import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIdentity, createClientIdentityMonitor } from '../../src/client-identity.js';

function req(remoteAddress,headers={}){return {socket:{remoteAddress},headers};}

test('trusted proxy missing X-Forwarded-For stays blocked and explains hosting fix',()=>{
  const m=createClientIdentityMonitor({proxyEnabled:true,trustProxy:true},{now:()=>0});
  m.observe(req('127.0.0.1',{'x-forwarded-proto':'https','x-forwarded-host':'example.com'}));
  const s=m.snapshot();
  assert.equal(s.status,'degraded');
  assert.equal(s.enforcementSafe,false);
  assert.equal(s.reason,'trusted_proxy_client_ip_unavailable');
  assert.equal(s.diagnostics.verdict,'trusted_proxy_missing_client_ip');
  assert.equal(s.diagnostics.remediationCode,'hosting_proxy_must_supply_sanitized_x_forwarded_for');
  assert.equal(s.diagnostics.requiresHostingChange,true);
  assert.equal(s.diagnostics.missingForwardedForWhileTrustedProxy,1);
});

test('invalid forwarded client address is counted without exposing its value',()=>{
  const m=createClientIdentityMonitor({proxyEnabled:true,trustProxy:true},{now:()=>0});
  m.observe(req('127.0.0.1',{'x-forwarded-proto':'https','x-forwarded-for':'definitely-not-an-ip'}));
  const s=m.snapshot();
  assert.equal(s.reason,'trusted_proxy_client_ip_invalid');
  assert.equal(s.diagnostics.forwardedForObservations,1);
  assert.equal(s.diagnostics.forwardedForInvalidObservations,1);
  assert.equal(s.diagnostics.rawForwardedHeaderExposed,false);
  assert.equal(JSON.stringify(s).includes('definitely-not-an-ip'),false);
});

test('valid trusted forwarded address reports enforcement-safe without exposing raw IP in snapshot',()=>{
  const m=createClientIdentityMonitor({proxyEnabled:true,trustProxy:true},{now:()=>0});
  const identity=m.observe(req('127.0.0.1',{'x-forwarded-proto':'https','x-forwarded-for':'203.0.113.9, 10.0.0.1'}));
  const s=m.snapshot();
  assert.equal(identity.ip,'203.0.113.9');
  assert.equal(s.status,'trusted');
  assert.equal(s.enforcementSafe,true);
  assert.equal(s.diagnostics.verdict,'trusted_client_identity');
  assert.equal(s.diagnostics.forwardedForValidObservations,1);
  assert.equal(JSON.stringify(s).includes('203.0.113.9'),false);
});

test('proxy detected with trust disabled recommends verification before enabling trust',()=>{
  const m=createClientIdentityMonitor({proxyEnabled:true,trustProxy:false},{now:()=>0});
  m.observe(req('127.0.0.1',{'x-forwarded-proto':'https','x-forwarded-host':'example.com'}));
  const s=m.snapshot();
  assert.equal(s.reason,'proxy_client_ip_unavailable');
  assert.equal(s.diagnostics.verdict,'proxy_detected_trust_disabled');
  assert.equal(s.diagnostics.remediationCode,'verify_sanitized_forwarding_before_enabling_trust');
  assert.equal(s.diagnostics.proxyHintsObserved,true);
  assert.equal(s.diagnostics.internalProxyHopObserved,true);
});

test('resolveClientIdentity keeps enforcement semantics while adding safe request diagnostics',()=>{
  const i=resolveClientIdentity(req('203.0.113.10',{'x-forwarded-for':'198.51.100.50'}),{proxyEnabled:true,trustProxy:false});
  assert.equal(i.enforcementSafe,true);
  assert.equal(i.ip,'203.0.113.10');
  assert.equal(i.source,'socket');
  assert.equal(i.diagnostics.forwardedForPresent,true);
  assert.equal(i.diagnostics.forwardedForValid,true);
});

test('sticky degraded process keeps last degraded reason for diagnostics',()=>{
  const m=createClientIdentityMonitor({proxyEnabled:true,trustProxy:true},{now:()=>0});
  m.observe(req('127.0.0.1',{'x-forwarded-proto':'https'}));
  m.observe(req('127.0.0.1',{'x-forwarded-proto':'https','x-forwarded-for':'203.0.113.9'}));
  const s=m.snapshot();
  assert.equal(s.status,'degraded');
  assert.equal(s.enforcementSafe,false);
  assert.equal(s.reason,'trusted_proxy_client_ip_unavailable');
  assert.equal(s.trustedObservations,1);
  assert.equal(s.degradedObservations,1);
});
