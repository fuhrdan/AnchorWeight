import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../src/store.js';

test('store expires sessions and blocks at their deadlines', () => {
  let now=1000; const store=new MemoryStore(()=>now);
  store.createSession('s',{expiresAt:2000});
  store.block('k',1,'test');
  assert.ok(store.getSession('s'));
  assert.ok(store.isBlocked('k'));
  now=61001;
  assert.equal(store.getSession('s'),undefined);
  assert.equal(store.isBlocked('k'),null);
});

test('store offense counters increment independently', () => {
  const store=new MemoryStore();
  assert.equal(store.noteOffense('a'),1);
  assert.equal(store.noteOffense('a'),2);
  assert.equal(store.noteOffense('b'),1);
});

test('store returns public Bot DNA IDs and persists explicit policy in profile memory', () => {
  const store=new MemoryStore();
  store.getProfile('abcdefghijk').score=10;
  const p=store.setManualPolicyById('AW-ABCDEFGH','allow');
  assert.equal(p.id,'AW-ABCDEFGH');
  assert.equal(p.manualPolicy,'allow');
  assert.equal(store.getPublicProfileById('AW-ABCDEFGH').classification,'manually_allowed');
});
