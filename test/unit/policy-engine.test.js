import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicyDecision, POLICY_ACTIONS, POLICY_ACTION_LADDER } from '../../src/policy-engine.js';

function scores(automation=0, policy=0, pressure=0) {
  return {automationConfidence:{score:automation},policyRisk:{score:policy},resourcePressure:{score:pressure}};
}
function profile(overrides={}) {
  return {manualPolicy:null,goodBotVerified:false,agentIdentity:{current:{trafficClass:'browser_or_unknown'}},proofOfCrawl:0,blackholeVisits:0,invalidTraversals:0,score:7,...overrides};
}
const shadow={policyEngineEnabled:true,policyEngineShadowMode:true,policyEngineEnforcementEnabled:false,shadowMode:true};

test('policy action ladder is stable and ordered',()=>{
  assert.deepEqual(POLICY_ACTION_LADDER,['allow','observe','budget','throttle','decoy','quarantine']);
});

test('ordinary low-pressure browser is allowed',()=>{
  assert.equal(evaluatePolicyDecision(profile(),scores(),{status:'within_budget'},shadow).action,POLICY_ACTIONS.ALLOW);
});

test('manual allow wins over high risk and exceeded budget',()=>{
  const d=evaluatePolicyDecision(profile({manualPolicy:'allow',blackholeVisits:3}),scores(95,100,100),{status:'exceeded'},shadow);
  assert.equal(d.action,POLICY_ACTIONS.ALLOW);
});

test('verified search crawler is allowed despite high automation confidence',()=>{
  const d=evaluatePolicyDecision(profile({goodBotVerified:true}),scores(95,0,20),{status:'within_budget'},shadow);
  assert.equal(d.action,POLICY_ACTIONS.ALLOW);
});

test('known automation with low risk is observed rather than punished',()=>{
  const d=evaluatePolicyDecision(profile({agentIdentity:{current:{trafficClass:'user_directed_agent'}}}),scores(88,0,15),{status:'within_budget'},shadow);
  assert.equal(d.action,POLICY_ACTIONS.OBSERVE);
});

test('approaching budget produces budget action',()=>{
  const d=evaluatePolicyDecision(profile(),scores(20,0,30),{status:'approaching'},shadow);
  assert.equal(d.action,POLICY_ACTIONS.BUDGET);
});

test('exceeded budget plus automated pressure produces throttle recommendation',()=>{
  const d=evaluatePolicyDecision(profile({agentIdentity:{current:{trafficClass:'unknown_automation'}}}),scores(80,10,82),{status:'exceeded'},shadow);
  assert.equal(d.action,POLICY_ACTIONS.THROTTLE);
  assert.equal(d.enforcementEligible,false);
});

test('high policy risk produces decoy before quarantine threshold',()=>{
  const d=evaluatePolicyDecision(profile(),scores(80,70,40),{status:'within_budget'},shadow);
  assert.equal(d.action,POLICY_ACTIONS.DECOY);
});

test('corroborated very high policy risk produces quarantine',()=>{
  const d=evaluatePolicyDecision(profile({blackholeVisits:1}),scores(90,95,50),{status:'within_budget'},shadow);
  assert.equal(d.action,POLICY_ACTIONS.QUARANTINE);
});

test('enforcement requires explicit enable plus both shadow modes off',()=>{
  const base=profile({blackholeVisits:1});
  const d=evaluatePolicyDecision(base,scores(90,95,50),{status:'within_budget'},{policyEngineEnabled:true,policyEngineShadowMode:false,policyEngineEnforcementEnabled:true,shadowMode:false});
  assert.equal(d.action,POLICY_ACTIONS.QUARANTINE);
  assert.equal(d.enforcementEligible,true);
  assert.equal(d.enforcement,'eligible');
});
