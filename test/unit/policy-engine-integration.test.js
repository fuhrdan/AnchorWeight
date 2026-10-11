import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicyDecision, publicPolicyDecision } from '../../src/policy-engine.js';

function s(a,p,r){return {automationConfidence:{score:a},policyRisk:{score:p},resourcePressure:{score:r}};}

test('policy evaluation never mutates legacy score or budget',()=>{
  const profile={score:37,manualPolicy:null,goodBotVerified:false,agentIdentity:{current:{trafficClass:'unknown_automation'}},proofOfCrawl:0,blackholeVisits:0,invalidTraversals:0};
  const budget={status:'exceeded',utilization:{requestsPerMinute:150}};
  const beforeProfile=JSON.stringify(profile),beforeBudget=JSON.stringify(budget);
  evaluatePolicyDecision(profile,s(85,20,90),budget,{policyEngineEnabled:true,policyEngineShadowMode:true,shadowMode:true});
  assert.equal(profile.score,37);
  assert.equal(JSON.stringify(profile),beforeProfile);
  assert.equal(JSON.stringify(budget),beforeBudget);
});

test('manual quarantine remains explicit highest-priority policy',()=>{
  const d=evaluatePolicyDecision({score:0,manualPolicy:'quarantine',goodBotVerified:true},s(0,0,0),{status:'within_budget'},{policyEngineEnabled:true,policyEngineShadowMode:true,shadowMode:true});
  assert.equal(d.action,'quarantine');
  assert.equal(d.reasons[0].code,'manual_quarantine');
});

test('public policy projection is bounded and contains no raw request data',()=>{
  const profile={policyDecision:{version:1,enabled:true,action:'throttle',enforcement:'shadow_only',wouldEnforce:true,evaluatedAt:1,reasons:[{code:'resource_budget_exceeded',detail:{resourcePressure:90}}],inputs:{trafficClass:'unknown_automation',automationConfidence:90,policyRisk:10,resourcePressure:90,resourceBudgetStatus:'exceeded',manualPolicy:null,verifiedSearchCrawler:false,proofOfCrawl:0,blackholeVisits:0,invalidTraversals:0}},rawIp:'203.0.113.7',rawPath:'/secret'};
  const text=JSON.stringify(publicPolicyDecision(profile));
  assert.match(text,/throttle/);
  assert.doesNotMatch(text,/203\.0\.113\.7|\/secret/);
});
