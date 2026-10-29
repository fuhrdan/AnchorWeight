import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCanaryIntelligence } from '../../src/canary-intelligence.js';

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (k,v) => { res.headers[k] = v; };
  res.end = body => { res.body = body; res.ended = true; };
  return res;
}

const config = {
  secret: 'test-secret-1234567890',
  canaryEnabled: true,
  canaryShadowMode: true,
  canaryFileTrapsEnabled: true,
  canaryRouteTrapsEnabled: true,
  canaryTokenTrapsEnabled: true,
  canaryTokenTtlSeconds: 3600,
  canaryCookieEnabled: false,
  canaryCookieName: '__Host-awci',
  canaryCookieThreshold: 85,
  canaryCookieTtlSeconds: 1800,
  scoreSharedCanary: 20,
  scoreProofOfCrawl: 40
};

test('normal path is ignored', async () => {
  const canary = createCanaryIntelligence(config);
  const req = { headers:{} };
  const res = response();
  const profile = {};

  const result = await canary.handle(
    req,
    res,
    new URL('https://example.com/normal'),
    { key:'abc', profile, behavior:{} }
  );

  assert.equal(result.handled, false);
});

test('/.enf returns inert synthetic config', async () => {
  const canary = createCanaryIntelligence(config);
  const req = { headers:{} };
  const res = response();
  const profile = {};

  const behavior = {
    noteLure() {},
    updatePolicyDecision() {}
  };

  const result = await canary.handle(
    req,
    res,
    new URL('https://example.com/.enf'),
    { key:'abc', profile, behavior }
  );

  assert.equal(result.handled, true);
  assert.equal(result.kind, 'discovery');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /CONFIG_ENDPOINT=\/internal\/bootstrap\//);
  assert.match(res.body, /INTERNAL_API_KEY=aw_canary_/);
});

test('cookie is not issued when disabled', async () => {
  const canary = createCanaryIntelligence(config);
  const req = { headers:{} };
  const res = response();
  const profile = {};

  await canary.handle(
    req,
    res,
    new URL('https://example.com/.enf'),
    {
      key:'abc',
      profile,
      behavior:{
        noteLure() {},
        updatePolicyDecision() {}
      }
    }
  );

  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('degraded identity serves trap without client-scoped evidence', async () => {
  const canary = createCanaryIntelligence(config);
  const req = { headers:{} };
  const res = response();

  const result = await canary.handle(
    req,
    res,
    new URL('https://example.com/.enf'),
    {
      key:null,
      profile:null,
      behavior:null,
      trusted:false
    }
  );

  assert.equal(result.handled, true);
  assert.equal(result.kind, 'discovery');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /CONFIG_ENDPOINT=\/internal\/bootstrap\//);
  assert.equal(res.headers['Set-Cookie'], undefined);
});
