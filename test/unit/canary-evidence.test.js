import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { branchToken, nextToken, childEntries, inspectChain } from '../../src/procedural.js';
import { createAnchorWeight } from '../../src/anchorweight.js';
import { MemoryStore } from '../../src/store.js';
import { noteEvidence } from '../../src/evidence.js';
import { PersistentStore } from '../../src/persistent-store.js';
import { createStore } from '../../src/create-store.js';

const secret = 'test-canary-secret';
function config(overrides = {}) {
  return {
    secret, basePath:'/anchor', blockDepth:3, branchCount:7, canaryVariantsEnabled:true,
    shadowMode:true, sessionBindIp:true, sessionTtlMinutes:30,
    blockMinutes:60, repeatBlockMinutes:1440, quarantineMode:'decoy',
    trustProxy:false, dashboardEnabled:false, logFile:'/tmp/aw-v13-test.jsonl',
    ...overrides
  };
}
function req(ip = '203.0.113.1') { return { method:'GET', headers:{}, socket:{ remoteAddress:ip } }; }
function res() {
  return { statusCode:0, body:'', setHeader(){}, end(body=''){this.body=String(body);} };
}
function make(store = new MemoryStore(), overrides = {}) {
  const events = [];
  const aw = createAnchorWeight(config(overrides), {
    store, log: event=>events.push(event), goodBots:{verify:async()=>({claimed:false,verified:false})}
  });
  return {aw,store,events};
}
function links(body) { return [...body.matchAll(/href="([^"]+)"/g)].map(m=>m[1]); }
function start(aw, request = req()) {
  const response = res();
  aw.handle(request, response, new URL('http://localhost/anchor/'));
  assert.equal(response.statusCode,200);
  return links(response.body);
}
function follow(aw, href, request = req()) {
  const response=res();
  aw.handle(request,response,new URL('http://localhost'+href));
  return response;
}

test('seven branches have seven distinct signed URLs and branch zero keeps legacy token',()=>{
  const entries=childEntries(secret,'session',[],7);
  assert.equal(new Set(entries.map(e=>e.token)).size,7);
  assert.equal(entries[0].token,nextToken(secret,'session',1,''));
  assert.deepEqual(entries.map(e=>e.branch),[0,1,2,3,4,5,6]);
  assert.equal(inspectChain(secret,'session',[entries[6].token],7)[0],6);
  assert.equal(inspectChain(secret,'session',[entries[6].token],7,false),null);
  assert.deepEqual(new Set(childEntries(secret,'session',[],7,false).map(e=>e.token)).size,1);
});

test('branch path lineage validates and tampering at any depth is rejected',()=>{
  const first=branchToken(secret,'session',1,'',3);
  const second=branchToken(secret,'session',2,first,5);
  const third=branchToken(secret,'session',3,second,2);
  assert.deepEqual(inspectChain(secret,'session',[first,second,third],7),[3,5,2]);
  assert.equal(inspectChain(secret,'session',[first,branchToken(secret,'other',2,first,5)],7),null);
  assert.equal(inspectChain(secret,'session',[first,second+'bad'],7),null);
  assert.equal(inspectChain(secret,'session',[first,second],2),null);
});

test('different trap links progress independently with branch and time evidence',()=>{
  const {aw,store,events}=make();
  const paths=start(aw);
  assert.equal(new Set(paths).size,7);
  const response=follow(aw,paths[4]);
  assert.equal(response.statusCode,200);
  const session=[...store.sessions.values()][0];
  assert.deepEqual(session.branches,[4]);
  const profile=[...store.profiles.values()][0];
  assert.ok(profile.evidence.some(e=>e.kind==='traversal' && e.branch===4 && e.depth===1));
  assert.ok(events.some(e=>e.type==='traversal' && e.branchPath.join(',')==='4'));
  assert.equal(JSON.stringify(profile.evidence).includes(paths[4]),false);
  assert.equal(follow(aw,paths[2]).statusCode,404,'a second branch at same depth is out of sequence');
});

test('guessed session ID or tampered canary must not create cross-client campaign',()=>{
  const {aw,store}=make();
  const paths=start(aw);
  const forged=paths[1].slice(0,-1)+(paths[1].endsWith('X')?'Y':'X');
  assert.equal(follow(aw,forged,req('198.51.100.2')).statusCode,404);
  assert.equal(follow(aw,'/anchor/t/fake-session/aaaaaaaaaaaaaaaaaa',req('198.51.100.2')).statusCode,404);
  assert.equal(store.campaigns.size,0);
  assert.equal(follow(aw,paths[1],req('198.51.100.2')).statusCode,404);
  assert.equal(store.campaigns.size,1);
  const campaign=[...store.campaigns.values()][0];
  const confidence=campaign.confidence;
  const evidenceCount=campaign.evidence.length;
  follow(aw,paths[1],req('198.51.100.2'));
  assert.equal(campaign.confidence,confidence);
  assert.equal(campaign.evidence.length,evidenceCount);
  assert.equal(store.stats.campaignCorrelations,1);
});

test('malformed path encoding is safely rejected by trap handler',()=>{
  const {aw}=make();
  const response=res();
  assert.doesNotThrow(()=>aw.handle(req(),response,new URL('http://localhost/anchor/t/%E0%A4%A/x')));
  assert.equal(response.statusCode,404);
});

test('recent evidence is bounded, privacy-safe and repeat offenses survive JSON reopen',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v13-json-'));
  try {
    const stateFile=path.join(dir,'state.json');
    const store=new PersistentStore(stateFile);
    const key='abcdef123456';
    for(let i=0;i<20;i++) noteEvidence(store,key,{kind:'traversal',sid:'safesession',depth:1,branch:i%7,reason:'not_a_path',evil:'secret'});
    assert.equal(store.getProfile(key).evidence.length,16);
    store.noteOffense(key);store.noteOffense(key);store.flush();
    const reopened=new PersistentStore(stateFile);
    const profile=reopened.getPublicProfileById('AW-ABCDEF12');
    assert.equal(profile.offenseCount,2);
    assert.ok(profile.lastOffenseAt);
    assert.equal(profile.evidence.length,12);
    assert.equal(JSON.stringify(profile).includes('secret'),false);
    assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).version,5);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('evidence and repeat offenses survive SQLite reopen', {skip: Number(process.versions.node.split('.')[0])<22}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v13-sqlite-'));
  try {
    const c={stateBackend:'sqlite',stateFile:path.join(dir,'old.json'),sqliteFile:path.join(dir,'state.sqlite')};
    const store=await createStore(c);
    noteEvidence(store,'abcdef123456',{kind:'proof_of_crawl',sid:'safesession',depth:3});
    store.noteOffense('abcdef123456');store.close();
    const again=await createStore(c);
    const profile=again.getPublicProfileById('AW-ABCDEF12');
    assert.equal(profile.offenseCount,1);
    assert.equal(profile.evidence[0].kind,'proof_of_crawl');
    again.close();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
