import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createAnchorWeight } from '../../src/anchorweight.js';
import { MemoryStore } from '../../src/store.js';
import { createAgentPassport } from '../../src/agent-passport.js';
import { ANCHORWEIGHT_VERSION } from '../../src/version.js';

function responseCapture(){
  let body='';
  return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(v=''){body+=v;},get body(){return body;}};
}
function admin(){return {authenticate:()=>true,role:()=>'admin',rateLimit:()=>({allowed:true,remaining:99,resetMs:0}),clientKey:()=> 'test-admin'};}
function config(){return {
  secret:'rehearsal-integration-secret-32-characters',basePath:'/anchor',blackholeEnabled:true,blackholePath:'/anchor/blackhole',
  shadowMode:true,scoreEnforcementEnabled:false,quarantineScore:100,blockDepth:3,blockMinutes:60,repeatBlockMinutes:1440,
  sessionTtlMinutes:30,sessionBindIp:true,trustProxy:false,proxyEnabled:true,dashboardEnabled:true,dashboardToken:'unit-test-dashboard-token',
  logFile:path.join(os.tmpdir(),'aw-beta7-rehearsal.jsonl'),eventMaxMb:10,eventRetentionDays:1,branchCount:7,canaryVariantsEnabled:true,
  quarantineMode:'decoy',scoreLure:5,scoreTraversal:20,scoreProofOfCrawl:40,scoreInvalidTraversal:8,scoreBlackhole:100,scoreUaChange:10,
  scoreMissingUa:5,scoreAutomationUa:15,scoreRapidBurst:10,rapidRequestMs:250,rapidRequestBurst:6,scoreSpoofedGoodBot:25,scoreSharedCanary:20,
  goodBotVerificationEnabled:false,intelligenceEnabled:false,auditEnabled:false,policyEngineEnabled:true,policyEngineShadowMode:true,
  policyEngineEnforcementEnabled:false
};}

test('authenticated rehearsal endpoint is read-only and returns central runtime version',()=>{
  const store=new MemoryStore(()=>1_000_000);
  const p=store.getProfile('1234567890abcdef');
  p.requestCount=5;
  p.policyDecision={enabled:true,action:'observe',reasons:[],inputs:{}};
  p.policyForensics={version:1,evaluations:5,transitions:0,highImpactRecommendations:0,lastAt:1_000_000,currentAction:'observe',currentReasonCodes:[],actionCounts:{allow:0,observe:5,budget:0,throttle:0,decoy:0,quarantine:0},reasonCounts:{},recent:[]};
  const aw=createAnchorWeight(config(),{store,log:()=>{},admin:admin(),publisher:{publish(){},status(){return {};}}});
  const req={method:'GET',headers:{},socket:{remoteAddress:'203.0.113.5'}};
  const res=responseCapture();
  const handled=aw.handle(req,res,new URL('http://test/anchor/api/policy/rehearsal'));
  assert.equal(handled,true);
  assert.equal(res.statusCode,200);
  const j=JSON.parse(res.body);
  assert.equal(j.version,ANCHORWEIGHT_VERSION);
  assert.equal(j.rehearsal.advisoryOnly,true);
  assert.equal(j.rehearsal.enforcement,false);
  assert.equal(j.rehearsal.evaluations,5);
  assert.equal(store.getProfile('1234567890abcdef').policyForensics.evaluations,5);
});

test('Agent Passport advertises rehearsal as authenticated, advisory and non-enforcing',()=>{
  const passport=createAgentPassport({shadowMode:true});
  assert.equal(passport.version,ANCHORWEIGHT_VERSION);
  assert.equal(passport.capabilities.enforcementRehearsal.authenticated,true);
  assert.equal(passport.capabilities.enforcementRehearsal.advisoryOnly,true);
  assert.equal(passport.capabilities.enforcementRehearsal.enforcement,false);
});
