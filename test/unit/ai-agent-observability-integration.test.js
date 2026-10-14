import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnchorWeight } from '../../src/anchorweight.js';
import { MemoryStore } from '../../src/store.js';
import { createAiAgentTrafficObservatory } from '../../src/ai-agent-traffic-observatory.js';
import { createAgentPassport } from '../../src/agent-passport.js';

function responseCapture() {
  let body='';
  return {
    statusCode:0,headers:{},
    setHeader(k,v){this.headers[String(k).toLowerCase()]=String(v);},
    end(v=''){body+=String(v);},
    get body(){return body;}
  };
}

function config() {
  return {
    secret:'alpha4-integration-secret-32-characters',
    basePath:'/anchor',dashboardEnabled:true,dashboardToken:'alpha4-dashboard-token',
    auditEnabled:false,logFile:'/tmp/aw-alpha4-test.jsonl',eventMaxMb:1,eventRetentionDays:1,
    aiAgentPolicyEnabled:true,aiAgentPolicyShadowMode:true,aiAgentPolicyEnforcementEnabled:false,
    aiAgentTrainingAction:'observe',aiAgentSearchAction:'allow',aiAgentUserAction:'observe',
    aiAgentAutomationAction:'observe',aiAgentFamilyRules:[],
    aiAgentVerificationRules:['openai:oai-searchbot@unverified=deny']
  };
}

test('runtime records verification-aware AI decision and exposes authenticated aggregate',async()=>{
  const traffic=createAiAgentTrafficObservatory({now:()=>1_000});
  const identityMonitor={
    observe(){return {enforcementSafe:false,status:'degraded',reason:'test_identity'};},
    snapshot(){return {enforcementSafe:false,status:'degraded',reason:'test_identity'};}
  };
  const verifier={
    async verify(){return {status:'unverified',verified:false,provider:'openai',family:'oai-searchbot',
      method:'published_cidr',scope:'family_network',reason:'published_range_mismatch',trustGranted:false};}
  };
  const admin={authenticate:()=>true,rateLimit:()=>({allowed:true,remaining:99,resetMs:0}),clientKey:()=> 'test-admin'};
  const aw=createAnchorWeight(config(),{
    store:new MemoryStore(()=>1_000),log:()=>{},
    publisher:{publish(){},status(){return {enabled:false};}},
    identityMonitor,aiAgentVerifier:verifier,aiAgentTrafficObservatory:traffic,admin,
    behavior:{},goodBots:{},campaigns:{}
  });

  const req={method:'GET',headers:{'user-agent':'OAI-SearchBot/1.4'}};
  const res=responseCapture();
  assert.equal(await aw.preflight(req,res,new URL('https://example.test/')),false);

  const snapshot=traffic.snapshot();
  assert.equal(snapshot.requests,1);
  assert.equal(snapshot.verification.unverified,1);
  assert.equal(snapshot.outcomes.would_deny,1);
  assert.equal(snapshot.verificationPolicyMatches,1);

  const apiRes=responseCapture();
  assert.equal(aw.handle({method:'GET',headers:{}},apiRes,new URL('https://example.test/anchor/api/ai-agents')),true);
  assert.equal(apiRes.statusCode,200);
  const body=JSON.parse(apiRes.body);
  assert.equal(body.aiAgentTraffic.requests,1);
  assert.equal(body.aiAgentTraffic.privacy.rawIpRetained,false);
});

test('Agent Passport advertises authenticated bounded AI observability',()=>{
  const p=createAgentPassport({});
  assert.equal(p.capabilities.aiAgentControls.version,5);
  assert.equal(p.capabilities.aiAgentControls.observability.available,true);
  assert.equal(p.capabilities.aiAgentControls.observability.authenticated,true);
  assert.equal(p.capabilities.aiAgentControls.observability.enforcement,false);
  assert.equal(p.capabilities.aiAgentControls.observability.rawUserAgentRetained,false);
});
