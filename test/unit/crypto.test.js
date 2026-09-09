import test from 'node:test';
import assert from 'node:assert/strict';
import { shortHmac, safeEqual, randomId, ipFingerprint } from '../../src/crypto.js';

test('crypto shortHmac is deterministic and secret-sensitive', () => {
  assert.equal(shortHmac('a','value',12), shortHmac('a','value',12));
  assert.notEqual(shortHmac('a','value',12), shortHmac('b','value',12));
  assert.equal(shortHmac('a','value',12).length,12);
});

test('crypto safeEqual rejects different lengths and accepts exact match', () => {
  assert.equal(safeEqual('token','token'),true);
  assert.equal(safeEqual('token','token2'),false);
  assert.equal(safeEqual('token','tokEn'),false);
});

test('crypto randomId generates URL-safe non-repeating identifiers', () => {
  const a=randomId(), b=randomId();
  assert.match(a,/^[A-Za-z0-9_-]+$/);
  assert.notEqual(a,b);
});

test('ipFingerprint is stable but does not expose the raw IP', () => {
  const value=ipFingerprint('secret','203.0.113.9');
  assert.equal(value,ipFingerprint('secret','203.0.113.9'));
  assert.equal(value.includes('203.0.113.9'),false);
});
