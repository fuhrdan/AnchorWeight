import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { projectFederatedEvent, createEvidencePublisher, messageMac } from '../../src/distributed.js';
import { createIntelligenceHub } from '../../src/intelligence-hub.js';
import { validateConfig } from '../../src/config-schema.js';
import { loadConfig } from '../../src/config.js';

const secret='S'.repeat(48);
const admin='A'.repeat(48);
const event = projectFederatedEvent({type:'would_block',ipKey:'abcdefghijklmnopqrstuv',sid:'private',depth:3,
  branchPath:['token1'],cookies:'private',rawIp:'203.0.113.4'});

test('projection exposes only bounded, site-scoped evidence',()=>{
  assert.deepEqual(event,{type:'would_block',botId:'AW-ABCDEFGH',depth:3,proof:'local_signed_traversal'});
  assert.equal(projectFederatedEvent({type:'raw_visit',ipKey:'abcde12345678'}),null);
  assert.equal(projectFederatedEvent({type:'would_block',ipKey:'bad'}),null);
  assert.deepEqual(projectFederatedEvent({type:'campaign_correlation',campaignId:'AWC-ABCDEF12',members:2,confidence:45}),
    {type:'campaign_correlation',campaignId:'AWC-ABCDEF12',members:2,confidence:45,proof:'local_campaign_correlation'});
});

test('federation is default-off; invalid configuration and plaintext endpoints rejected',()=>{
  const previous = process.env.AW_INTELLIGENCE_ENABLED;
  delete process.env.AW_INTELLIGENCE_ENABLED;
  try { assert.equal(loadConfig().intelligenceEnabled,false); }
  finally { if(previous===undefined)delete process.env.AW_INTELLIGENCE_ENABLED; else process.env.AW_INTELLIGENCE_ENABLED=previous; }
  // Validate federation independently of other features enabled on a live host.
  const basic={...loadConfig({routesEnabled:false,setupConfigEnabled:false,
    setupWritesEnabled:false,declarativeEnabled:false,declarativeWritesEnabled:false,
    trustedJa4Enabled:false,appAuthEnabled:false}), intelligenceEnabled:true,intelligenceSiteId:'site_one',
    intelligenceSiteSecret:secret,intelligenceHubUrl:'http://example.org/v1/evidence'};
  assert.equal(validateConfig(basic).valid,false);
  assert.equal(validateConfig({...basic,intelligenceHubUrl:'https://hub.example/v1/evidence'}).valid,true);
});

test('hub verifies HMAC, enforces replay and site isolation, persists, and rejects unapproved fields',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-hub-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'events.jsonl');
  const hub=createIntelligenceHub({sites:{site_one:secret,site_two:'T'.repeat(48)},file,adminToken:admin});
  await new Promise(r=>hub.server.listen(0,'127.0.0.1',r));
  t.after(()=>hub.server.close());
  const base=`http://127.0.0.1:${hub.server.address().port}`;
  async function send(payload,opts={}){
    const body=JSON.stringify(payload);
    const ts=String(Date.now()),nonce=opts.nonce||crypto.randomBytes(16).toString('hex');
    return fetch(`${base}/v1/evidence`,{method:'POST',headers:{'Content-Type':'application/json',
      'X-AW-Site':opts.site||'site_one','X-AW-Timestamp':ts,'X-AW-Nonce':nonce,
      'X-AW-Signature': opts.badSig?'0'.repeat(64):messageMac(secret,ts,nonce,body)},body});
  }
  const payload={schema:'anchorweight-evidence-v1',siteId:'site_one',eventId:crypto.randomUUID(),
    observedAt:new Date().toISOString(),evidence:event};
  assert.equal((await send(payload,{badSig:true})).status,401);
  const nonce=crypto.randomBytes(16).toString('hex');
  assert.equal((await send(payload,{nonce})).status,202);
  assert.equal((await send(payload,{nonce})).status,409);
  assert.equal((await send(payload)).status,200); // dedupe survives retry with new nonce
  assert.equal((await send({...payload,eventId:crypto.randomUUID(),evidence:{...event,rawIp:'203.0.113.4'}})).status,400);
  assert.equal((await send({...payload,eventId:crypto.randomUUID(),siteId:'site_two'})).status,400);
  assert.equal((await fetch(`${base}/v1/events`)).status,401);
  const read=await fetch(`${base}/v1/events`,{headers:{Authorization:`Bearer ${admin}`}});
  assert.equal(read.status,200);
  const data=await read.json();
  assert.equal(data.total,1);
  assert.equal(data.events[0].siteId,'site_one');
  assert.equal(JSON.stringify(data).includes('203.0.113.4'),false);
  const persisted=fs.readFileSync(file,'utf8');
  assert.equal(persisted.includes('private'),false);
  assert.equal(createIntelligenceHub({sites:{site_one:secret},file,adminToken:admin}).getEvents().length,1);
});

test('publisher retries without rejecting local work, ignores unrelated events', async()=>{
  const records=[];
  let attempts=0;
  const pub=createEvidencePublisher({intelligenceEnabled:true,intelligenceSiteId:'site_one',
    intelligenceSiteSecret:secret,intelligenceHubUrl:'http://127.0.0.1:1/v1/evidence'}, {
    fetch:async(url,req)=>{attempts++;if(attempts===1)throw new Error('temporary');records.push(JSON.parse(req.body));return {ok:true};},
    delay:cb=>setImmediate(cb)
  });
  pub.publish({type:'raw_visit',ipKey:'abcdefghijkl'});
  pub.publish({type:'would_block',ipKey:'abcdefghijkl',depth:3,sid:'private'});
  for(let i=0;i<100 && pub.status().queued;i++) await new Promise(r=>setTimeout(r,1));
  assert.equal(attempts,2);
  assert.equal(records.length,1);
  assert.equal(records[0].evidence.botId,'AW-ABCDEFGH');
  assert.equal(pub.status().queued,0);
  pub.stop();
});

test('two sensors deliver separately authenticated, site-scoped events without joining identities',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-multisite-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const siteTwoSecret='Z'.repeat(48);
  const hub=createIntelligenceHub({sites:{site_one:secret,site_two:siteTwoSecret},
    file:path.join(dir,'events.jsonl'),adminToken:admin});
  await new Promise(r=>hub.server.listen(0,'127.0.0.1',r));
  t.after(()=>hub.server.close());
  const hubUrl=`http://127.0.0.1:${hub.server.address().port}/v1/evidence`;
  const first=createEvidencePublisher({intelligenceEnabled:true,intelligenceSiteId:'site_one',
    intelligenceSiteSecret:secret,intelligenceHubUrl:hubUrl});
  const second=createEvidencePublisher({intelligenceEnabled:true,intelligenceSiteId:'site_two',
    intelligenceSiteSecret:siteTwoSecret,intelligenceHubUrl:hubUrl});
  first.publish({type:'would_block',ipKey:'abcdefghijklmnop',depth:3});
  second.publish({type:'would_block',ipKey:'abcdefghijklmnop',depth:3});
  for(let n=0;n<100 && hub.getEvents().length<2;n++) await new Promise(r=>setTimeout(r,5));
  assert.equal(hub.getEvents().length,2);
  assert.deepEqual(hub.getEvents().map(e=>e.siteId),['site_one','site_two']);
  assert.equal(hub.getEvents()[0].evidence.botId,hub.getEvents()[1].evidence.botId);
  first.stop();second.stop();
});
