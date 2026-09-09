import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignEngine } from '../../src/campaigns.js';
import { MemoryStore } from '../../src/store.js';

test('campaign confidence increases only from concrete correlations',()=>{
  let now=1; const store=new MemoryStore(()=>now); const engine=new CampaignEngine({secret:'s'},store,()=>{},()=>now);
  const c=engine.correlate('a','b','shared_signed_canary');
  assert.equal(c.confidence,45); assert.equal(c.classification,'probable_shared_crawler');
  now++; engine.correlate('a','b','shared_signed_canary'); assert.equal(c.confidence,90); assert.equal(c.classification,'distributed_crawler_campaign');
  assert.equal(engine.correlate('a','a','shared_signed_canary'),null);
});
