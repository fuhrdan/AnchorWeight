import test from 'node:test';
import assert from 'node:assert/strict';
import { nextToken, validateChain, childEntries } from '../../src/procedural.js';

test('procedural chain validates only the correct lineage', () => {
  const secret='s', sid='session';
  const t1=nextToken(secret,sid,1,'');
  const t2=nextToken(secret,sid,2,t1);
  assert.equal(validateChain(secret,sid,[t1,t2]),true);
  assert.equal(validateChain(secret,sid,[t1,'tampered']),false);
});

test('procedural child listing is deterministic and bounded', () => {
  const a=childEntries('secret','sid',[],7);
  const b=childEntries('secret','sid',[],7);
  assert.deepEqual(a,b);
  assert.equal(a.length,7);
  assert.equal(a[0].decoy,false);
  assert.equal(a.slice(1).every(x=>x.decoy),true);
});
