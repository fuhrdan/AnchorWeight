import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePolicyScenario,
  policySimulationDescriptor,
  simulatePolicyScenario,
  POLICY_SIMULATION_MAX_PROFILES,
  POLICY_SIMULATION_MAX_CHANGES
} from '../../src/policy-simulation.js';

const config={
  policyObserveAutomation:65,
  policyThrottlePressure:70,
  policyDecoyRisk:65,
  policyQuarantineRisk:85,
  policyEngineEnabled:true,
  policyEngineEnforcementEnabled:true,
  policyEngineShadowMode:false,
  shadowMode:false
};

function profile(id,{a=0,p=0,r=0,budget='within_budget',action='allow',manualPolicy=null,verified=false,proof=0,blackhole=0,invalid=0}={}){
  return {
    id,
    manualPolicy,
    goodBot:{verified},
    agentIdentity:{trafficClass:a>=65?'unknown_automation':'browser_or_unknown'},
    proofOfCrawl:proof,
    blackholeVisits:blackhole,
    invalidTraversals:invalid,
    trafficScores:{automationConfidence:{score:a},policyRisk:{score:p},resourcePressure:{score:r}},
    resourceBudget:{status:budget},
    policyDecision:{action}
  };
}

test('scenario defaults mirror current operator thresholds',()=>{
  assert.deepEqual(normalizePolicyScenario({},config),{
    observeAutomation:65,throttlePressure:70,decoyRisk:65,quarantineRisk:85
  });
  const d=policySimulationDescriptor(config);
  assert.equal(d.readOnly,true);
  assert.equal(d.mutatesState,false);
  assert.equal(d.enforcement,false);
});

test('scenario validation rejects unknown, out-of-range and inverted risk thresholds',()=>{
  assert.throws(()=>normalizePolicyScenario({wat:1},config),/unknown_policy_simulation_field/);
  assert.throws(()=>normalizePolicyScenario({decoyRisk:0},config),/invalid_policy_simulation_decoy_risk/);
  assert.throws(()=>normalizePolicyScenario({quarantineRisk:101},config),/invalid_policy_simulation_quarantine_risk/);
  assert.throws(()=>normalizePolicyScenario({decoyRisk:90,quarantineRisk:80},config),/invalid_policy_simulation_risk_order/);
});

test('same thresholds preserve current actions for representative profiles',()=>{
  const profiles=[
    profile('AW-ALLOW',{action:'allow'}),
    profile('AW-OBSERVE',{a:70,action:'observe'}),
    profile('AW-DECOY',{p:70,action:'decoy'})
  ];
  const result=simulatePolicyScenario(profiles,{},config);
  assert.equal(result.changedProfiles,0);
  assert.equal(result.currentActions.observe,1);
  assert.equal(result.simulatedActions.decoy,1);
});

test('lower policy-risk threshold shows an escalation without mutating the profile',()=>{
  const p=profile('AW-RISK',{p:50,action:'observe'});
  const before=JSON.stringify(p);
  const result=simulatePolicyScenario([p],{decoyRisk:45},config,{now:123});
  assert.equal(result.changedProfiles,1);
  assert.equal(result.escalations,1);
  assert.equal(result.changes[0].currentAction,'observe');
  assert.equal(result.changes[0].simulatedAction,'decoy');
  assert.equal(JSON.stringify(p),before);
});

test('candidate evaluation is forced shadow-only even when live config is enforcement-enabled',()=>{
  const p=profile('AW-THROTTLE',{a:90,r:90,budget:'exceeded',action:'throttle'});
  const result=simulatePolicyScenario([p],{},config);
  assert.equal(result.enforcement,'simulation_only');
  assert.equal(result.stateMutation,false);
  assert.equal(result.simulatedActions.throttle,1);
});

test('manual allow and verified search crawler remain allow in simulations',()=>{
  const profiles=[
    profile('AW-MANUAL',{p:99,action:'allow',manualPolicy:'allow'}),
    profile('AW-GOODBOT',{p:99,action:'allow',verified:true})
  ];
  const result=simulatePolicyScenario(profiles,{decoyRisk:10,quarantineRisk:20},config);
  assert.equal(result.simulatedActions.allow,2);
  assert.equal(result.changedProfiles,0);
});

test('simulation output is privacy-bounded and contains no raw request material',()=>{
  const p=profile('AW-PRIVATE',{p:50,action:'observe'});
  p.rawIp='203.0.113.7';p.rawPath='/secret';p.rawUserAgent='secret-agent';p.cookie='session=secret';
  const text=JSON.stringify(simulatePolicyScenario([p],{decoyRisk:45},config));
  assert.doesNotMatch(text,/203\.0\.113\.7|\/secret|secret-agent|session=secret/);
  assert.match(text,/AW-PRIVATE/);
});

test('simulation sampling and changed-profile detail are bounded',()=>{
  const profiles=Array.from({length:POLICY_SIMULATION_MAX_PROFILES+20},(_,i)=>
    profile(`AW-${String(i).padStart(8,'0')}`,{p:50,action:'observe'}));
  const result=simulatePolicyScenario(profiles,{decoyRisk:45},config,{totalProfiles:profiles.length});
  assert.equal(result.sampledProfiles,POLICY_SIMULATION_MAX_PROFILES);
  assert.equal(result.truncated,true);
  assert.equal(result.changedProfiles,POLICY_SIMULATION_MAX_PROFILES);
  assert.equal(result.changes.length,POLICY_SIMULATION_MAX_CHANGES);
});
