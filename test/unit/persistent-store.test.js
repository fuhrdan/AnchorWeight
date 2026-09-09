import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersistentStore } from '../../src/persistent-store.js';
import { CURRENT_STATE_VERSION } from '../../src/migrations.js';

test('persistent store migrates v4 state and preserves profile policy',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-persist-')); const file=path.join(dir,'state.json');
  const profile={firstSeen:0,lastSeen:0,requestCount:0,lureVisits:0,validTraversals:0,invalidTraversals:0,proofOfCrawl:0,maxDepth:0,score:0,classification:'unknown',scoreConvicted:false,signalNames:[],signals:[],userAgents:[],methods:{},acceptSignatures:{},robotsRequests:0,intervalCount:0,intervalTotalMs:0,minIntervalMs:null,rapidRequestCount:0,goodBotClaimed:false,goodBotVerified:false,goodBotProvider:null,goodBotCheckReason:null,manualPolicy:'allow',trapSessions:{},recentTraversalDepths:[],traversalStyle:'unknown',campaignIds:[]};
  fs.writeFileSync(file,JSON.stringify({version:4,blocks:[],offenses:[],profiles:[['abcdef123456',profile]],campaigns:[]}));
  const store=new PersistentStore(file);
  assert.equal(store.loadedStateVersion,CURRENT_STATE_VERSION);
  assert.equal(store.getPublicProfileById('AW-ABCDEF12').manualPolicy,'allow');
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).version,CURRENT_STATE_VERSION);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('persistent store refuses corrupt and future state instead of starting empty',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-persist-bad-')); const file=path.join(dir,'state.json');
  fs.writeFileSync(file,'not-json');
  assert.throws(()=>new PersistentStore(file),/Unable to load AnchorWeight state/);
  fs.writeFileSync(file,JSON.stringify({version:999}));
  assert.throws(()=>new PersistentStore(file),/newer than/);
  fs.rmSync(dir,{recursive:true,force:true});
});
