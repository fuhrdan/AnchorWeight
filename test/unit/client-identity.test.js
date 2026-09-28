import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIdentity, createClientIdentityMonitor } from '../../src/client-identity.js';

function req(remoteAddress,headers={}){return {socket:{remoteAddress},headers};}

test('Passenger loopback with proxy hints is degraded when no trusted client IP exists',()=>{
  const i=resolveClientIdentity(req('127.0.0.1',{'x-forwarded-proto':'https','x-forwarded-host':'example.com'}),{proxyEnabled:true,trustProxy:false});
  assert.equal(i.status,'degraded');
  assert.equal(i.enforcementSafe,false);
  assert.equal(i.reason,'proxy_client_ip_unavailable');
});

test('trusted proxy mode requires a valid X-Forwarded-For address',()=>{
  const missing=resolveClientIdentity(req('127.0.0.1',{'x-forwarded-proto':'https'}),{proxyEnabled:true,trustProxy:true});
  assert.equal(missing.enforcementSafe,false);
  const valid=resolveClientIdentity(req('127.0.0.1',{'x-forwarded-for':'203.0.113.9, 10.0.0.1'}),{proxyEnabled:true,trustProxy:true});
  assert.equal(valid.enforcementSafe,true);
  assert.equal(valid.ip,'203.0.113.9');
  assert.equal(valid.source,'x-forwarded-for');
});

test('direct socket identity ignores spoofed forwarding headers when trustProxy is off',()=>{
  const i=resolveClientIdentity(req('203.0.113.10',{'x-forwarded-for':'198.51.100.50','x-real-ip':'198.51.100.60'}),{proxyEnabled:true,trustProxy:false});
  assert.equal(i.enforcementSafe,true);
  assert.equal(i.ip,'203.0.113.10');
  assert.equal(i.source,'socket');
});

test('identity monitor is sticky-degraded for the lifetime of the process',()=>{
  const m=createClientIdentityMonitor({proxyEnabled:true,trustProxy:false},{now:()=>0});
  m.observe(req('127.0.0.1',{'x-forwarded-proto':'https','x-forwarded-host':'example.com'}));
  m.observe(req('203.0.113.10',{}));
  const s=m.snapshot();
  assert.equal(s.status,'degraded');
  assert.equal(s.enforcementSafe,false);
  assert.equal(s.observations,2);
});
