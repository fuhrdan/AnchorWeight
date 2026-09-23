import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BehaviorEngine, publicProfile } from '../../src/behavior.js';
import { MemoryStore } from '../../src/store.js';
import { PersistentStore } from '../../src/persistent-store.js';
import { createStore } from '../../src/create-store.js';
import { loadConfig } from '../../src/config.js';
import { validateConfig } from '../../src/config-schema.js';

const KEY='abcdef12345678';
const SECRET='example-test-secret-never-use-live';
const JA4='t13d1516h2_8daaf6152771_02713d6af862';
const HEADERS={ 'user-agent':'Mozilla/5.0', accept:'text/html', 'x-aw-ja4':JA4 };
function make(overrides={}, store=new MemoryStore()) {
  const config={secret:SECRET, rapidRequestMs:250, rapidRequestBurst:6,
    scoreUaChange:10, scoreRapidBurst:10, scoreMissingUa:5,scoreAutomationUa:5,
    trustProxy:false,trustedJa4Enabled:false,...overrides};
  let tick=0;
  return {behavior:new BehaviorEngine(config,store,()=>{},()=>{tick+=1000;return tick;}),store};
}
function observe(behavior, headers=HEADERS) {
  return behavior.observeRequest(KEY,{method:'GET',headers},new URL('http://localhost/'));
}

test('Bot DNA 2.0 separates automation observations from signed-trap evidence',()=>{
  const {behavior,store}=make();
  observe(behavior, {'user-agent':'curl/8.0',accept:'*/*'});
  const p=store.getProfile(KEY);
  let a=publicProfile(KEY,p).assessment;
  assert.equal(a.automationObserved,true);
  assert.deepEqual(a.automationIndicators,['automation_user_agent']);
  assert.deepEqual(a.trapEvidence,[]);
  behavior.noteTraversal(KEY,1,'sessionId');
  behavior.noteProof(KEY,3);
  a=publicProfile(KEY,p).assessment;
  assert.deepEqual(a.trapEvidence,['signed_traversal','proof_of_crawl']);
  assert.match(a.limitations.join(' '),/does not necessarily mean malicious/);
});

test('missing JA4 is unavailable, not suspicious, and has no points',()=>{
  const {behavior,store}=make({trustProxy:true,trustedJa4Enabled:true});
  observe(behavior, {'user-agent':'Mozilla/5.0',accept:'text/html'});
  const p=publicProfile(KEY,store.getProfile(KEY));
  assert.equal(p.score,0);
  assert.deepEqual(p.assessment.tlsFingerprint,{available:false,source:null,variantsObserved:0,missingIsSuspicious:false});
});

test('forged public header is ignored unless trusted source explicitly enabled',()=>{
  for(const flags of [{trustProxy:false,trustedJa4Enabled:true},{trustProxy:true,trustedJa4Enabled:false}]) {
    const {behavior,store}=make(flags);
    observe(behavior);
    assert.deepEqual(store.getProfile(KEY).trustedTlsFingerprints,[]);
    assert.equal(publicProfile(KEY,store.getProfile(KEY)).assessment.tlsFingerprint.available,false);
  }
});

test('trusted fingerprint is keyed, bounded, privacy-safe, and never adds score',()=>{
  const {behavior,store}=make({trustProxy:true,trustedJa4Enabled:true});
  observe(behavior);observe(behavior);
  const p=store.getProfile(KEY);
  assert.equal(p.trustedTlsFingerprints.length,1);
  assert.equal(p.trustedTlsFingerprints[0].length,12);
  assert.equal(JSON.stringify(p).includes(JA4),false);
  assert.equal(p.score,0);
  assert.equal(publicProfile(KEY,p).assessment.tlsFingerprint.source,'trusted_proxy');
  for(let i=0;i<12;i++) observe(behavior,{...HEADERS,'x-aw-ja4':JA4+i});
  assert.equal(p.trustedTlsFingerprints.length,8);
  assert.equal(p.score,0);
});

test('malformed or multi-valued fingerprint header is ignored',()=>{
  const {behavior,store}=make({trustProxy:true,trustedJa4Enabled:true});
  for (const value of ['',JA4+'\nattack','x'.repeat(129),[JA4], 'a!bad!header']) {
    observe(behavior,{...HEADERS,'x-aw-ja4':value});
  }
  assert.deepEqual(store.getProfile(KEY).trustedTlsFingerprints,[]);
});

test('trusted fingerprint options require trusted reverse proxy and default off',()=>{
  // Isolate the validator fixture from unrelated live cPanel feature flags.
  // This test enables JA4/trustProxy explicitly in the two cases below.
  const base=loadConfig({secret:SECRET,routesEnabled:false,setupConfigEnabled:false,
    setupWritesEnabled:false,declarativeEnabled:false,declarativeWritesEnabled:false,
    intelligenceEnabled:false,trustedJa4Enabled:false,appAuthEnabled:false});
  assert.equal(base.trustedJa4Enabled,false);
  const invalid=validateConfig({...base,trustedJa4Enabled:true,trustProxy:false});
  assert.equal(invalid.valid,false);
  assert.match(invalid.errors.join('; '),/requires trustProxy/);
  const valid=validateConfig({...base,trustedJa4Enabled:true,trustProxy:true});
  assert.equal(valid.valid,true);
  assert.match(valid.warnings.join('; '),/OVERWRITE X-AW-JA4/);
});

test('older v1.3 profiles remain readable without new fingerprint field',()=>{
  const store=new MemoryStore();const p=store.getProfile(KEY);
  delete p.trustedTlsFingerprints;
  assert.equal(publicProfile(KEY,p).assessment.tlsFingerprint.available,false);
  p.goodBotClaimed=true;p.goodBotVerified=true;p.goodBotProvider='google';
  assert.equal(publicProfile(KEY,p).assessment.identity,'verified_search_crawler');
});

test('v1.4 observation survives JSON reopen without state-schema migration',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-botdna-json-'));
  try {
    const file=path.join(dir,'state.json');const store=new PersistentStore(file);
    const {behavior}=make({trustProxy:true,trustedJa4Enabled:true},store);
    observe(behavior);store.flush();
    const reopened=new PersistentStore(file);
    assert.equal(reopened.getPublicProfileById('AW-ABCDEF12').assessment.tlsFingerprint.variantsObserved,1);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).version,5);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('v1.4 observation survives SQLite reopen without state-schema migration', {skip:Number(process.versions.node.split('.')[0])<22}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-botdna-sqlite-'));
  try {
    const c={stateBackend:'sqlite',stateFile:path.join(dir,'old.json'),sqliteFile:path.join(dir,'state.sqlite')};
    const store=await createStore(c);
    const {behavior}=make({trustProxy:true,trustedJa4Enabled:true},store);
    observe(behavior);store.close();
    const reopened=await createStore(c);
    assert.equal(reopened.getPublicProfileById('AW-ABCDEF12').assessment.tlsFingerprint.variantsObserved,1);
    assert.equal(reopened.loadedStateVersion,5);
    reopened.close();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
