import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPolicyForensics, recordPolicyForensics, publicPolicyForensics } from '../../src/policy-forensics.js';

function decision(action='allow', reasons=['no_policy_intervention_needed'], extras={}) {
  return {
    action,
    reasons: reasons.map(code=>({code})),
    wouldEnforce:['throttle','decoy','quarantine'].includes(action),
    enforcementEligible:false,
    inputs:{automationConfidence:12,policyRisk:8,resourcePressure:20,resourceBudgetStatus:'within_budget'},
    ...extras
  };
}

test('empty forensics is stable and bounded',()=>{
  const value=emptyPolicyForensics();
  assert.equal(value.version,1);
  assert.equal(value.evaluations,0);
  assert.equal(value.transitions,0);
  assert.equal(value.recent.length,0);
});

test('evaluations count while duplicate decisions do not spam recent history',()=>{
  const profile={};
  recordPolicyForensics(profile,decision(),{now:1000});
  recordPolicyForensics(profile,decision(),{now:2000});
  assert.equal(profile.policyForensics.evaluations,2);
  assert.equal(profile.policyForensics.transitions,0);
  assert.equal(profile.policyForensics.actionCounts.allow,2);
  assert.equal(profile.policyForensics.recent.length,1);
});

test('action or reason changes create transitions and bounded recent entries',()=>{
  const profile={};
  recordPolicyForensics(profile,decision(),{now:1000});
  recordPolicyForensics(profile,decision('observe',['automation_observed']),{now:2000});
  recordPolicyForensics(profile,decision('observe',['policy_risk_observed']),{now:3000});
  assert.equal(profile.policyForensics.transitions,2);
  assert.equal(profile.policyForensics.recent.length,3);
  for(let i=0;i<20;i++) recordPolicyForensics(profile,decision(i%2?'decoy':'observe',[`reason_${i}`]),{now:4000+i});
  assert.equal(profile.policyForensics.recent.length,12);
});

test('high-impact recommendations are calibration counts, not enforcement',()=>{
  const profile={};
  recordPolicyForensics(profile,decision('throttle',['resource_budget_exceeded']),{now:1000});
  recordPolicyForensics(profile,decision('decoy',['high_policy_risk']),{now:2000});
  recordPolicyForensics(profile,decision('quarantine',['corroborated_policy_risk']),{now:3000});
  assert.equal(profile.policyForensics.highImpactRecommendations,3);
  assert.equal(profile.policyForensics.recent.every(x=>x.enforcementEligible===false),true);
});

test('public projection strips arbitrary state and exposes decision metadata only',()=>{
  const profile={policyForensics:{
    evaluations:5,transitions:2,highImpactRecommendations:1,currentAction:'decoy',currentReasonCodes:['high_policy_risk'],
    actionCounts:{decoy:1,evil:99},reasonCounts:{high_policy_risk:1,'../../secret':9},
    rawIp:'203.0.113.4',rawUserAgent:'secret',rawPath:'/private?token=secret',
    recent:[{at:123,action:'decoy',reasonCodes:['high_policy_risk'],wouldEnforce:true,enforcementEligible:false,
      inputs:{automationConfidence:88,policyRisk:72,resourcePressure:44,resourceBudgetStatus:'approaching'},rawPath:'/secret'}]
  }};
  const out=publicPolicyForensics(profile);
  assert.equal(out.actionCounts.evil,undefined);
  assert.equal(JSON.stringify(out).includes('203.0.113.4'),false);
  assert.equal(JSON.stringify(out).includes('rawUserAgent'),false);
  assert.equal(JSON.stringify(out).includes('/secret'),false);
  assert.equal(out.recent[0].inputs.policyRisk,72);
});
