import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createAnchorWeight } from '../../src/anchorweight.js';
import { MemoryStore } from '../../src/store.js';
import { nextToken } from '../../src/procedural.js';

async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
function request(port,pathname){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:pathname,headers:{'x-forwarded-proto':'https','x-forwarded-host':'example.com','user-agent':'test-agent'}},res=>{let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});}

function config(){return {secret:'identity-safety-secret-32-characters',basePath:'/anchor',blackholeEnabled:true,blackholePath:'/anchor/blackhole',shadowMode:false,scoreEnforcementEnabled:true,quarantineScore:1,blockDepth:3,blockMinutes:60,repeatBlockMinutes:1440,sessionTtlMinutes:30,sessionBindIp:true,trustProxy:false,proxyEnabled:true,dashboardEnabled:false,dashboardToken:'',logFile:path.join(os.tmpdir(),'aw-id-safety.jsonl'),eventMaxMb:10,eventRetentionDays:1,branchCount:7,canaryVariantsEnabled:true,quarantineMode:'decoy',scoreLure:5,scoreTraversal:20,scoreProofOfCrawl:40,scoreInvalidTraversal:8,scoreBlackhole:100,scoreUaChange:10,scoreMissingUa:5,scoreAutomationUa:15,scoreRapidBurst:10,rapidRequestMs:250,rapidRequestBurst:6,scoreSpoofedGoodBot:25,scoreSharedCanary:20,goodBotVerificationEnabled:false,intelligenceEnabled:false,auditEnabled:false};}

test('degraded proxy identity does not create a shared ordinary-traffic Bot DNA profile',async t=>{
  const c=config(),store=new MemoryStore(),aw=createAnchorWeight(c,{store,log:()=>{}});
  const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://test');if(await aw.preflight(req,res,url))return;res.end('ok');});
  const port=await listen(server);t.after(()=>server.close());
  await request(port,'/'); await request(port,'/games');
  assert.equal(store.snapshot().trackedProfiles,0);
  assert.equal(store.snapshot().activeBlocks,0);
  assert.equal(store.snapshot().identityDegradedRequests,2);
});

test('degraded identity keeps signed proof as session-only evidence without quarantine',async t=>{
  const c=config(),store=new MemoryStore(),aw=createAnchorWeight(c,{store,log:()=>{}});
  const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://test');return aw.handle(req,res,url);});
  const port=await listen(server);t.after(()=>server.close());
  await request(port,'/anchor');
  const [sid]=store.sessions.keys();
  const t1=nextToken(c.secret,sid,1,'');const t2=nextToken(c.secret,sid,2,t1);const t3=nextToken(c.secret,sid,3,t2);
  await request(port,`/anchor/t/${sid}/${t1}`);
  await request(port,`/anchor/t/${sid}/${t1}/${t2}`);
  await request(port,`/anchor/t/${sid}/${t1}/${t2}/${t3}`);
  const snap=store.snapshot();
  assert.equal(snap.activeBlocks,0);
  assert.equal(snap.trackedOffenders,0);
  assert.equal(snap.identityDegradedProofs,1);
  assert.equal(snap.topProfiles[0].identityScope,'session');
  assert.equal(snap.topProfiles[0].classification,'session_confirmed_recursive_crawler');
});
