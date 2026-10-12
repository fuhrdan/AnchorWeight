import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../src/store.js';

test('store exposes a bounded deterministic public-profile sample for simulation',()=>{
  const store=new MemoryStore(()=>1234);
  const low=store.getProfile('bbbbbbbbbbbbbbbb');
  low.requestCount=2; low.score=5;
  const high=store.getProfile('aaaaaaaaaaaaaaaa');
  high.requestCount=20; high.score=1;
  const mid=store.getProfile('cccccccccccccccc');
  mid.requestCount=10; mid.score=50;
  const profiles=store.getPublicProfiles(2);
  assert.equal(profiles.length,2);
  assert.equal(profiles[0].id,'AW-AAAAAAAA');
  assert.equal(profiles[1].id,'AW-CCCCCCCC');
  assert.equal(JSON.stringify(profiles).includes('aaaaaaaaaaaaaaaa'),false);
});

test('store simulation projection enforces the hard 500-profile cap',()=>{
  const store=new MemoryStore(()=>1234);
  for(let i=0;i<520;i++){
    const key=i.toString(16).padStart(16,'0');
    const p=store.getProfile(key);p.requestCount=i;
  }
  assert.equal(store.getPublicProfiles(9999).length,500);
});
