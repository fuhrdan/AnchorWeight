import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorEngine, newProfile, publicProfile } from '../../src/behavior.js';
import { buildAgentTrafficObservatory } from '../../src/agent-observatory.js';

function config() {
  return {
    resourceBudgetsEnabled:false,
    policyEngineEnabled:true,
    policyEngineShadowMode:true,
    policyEngineEnforcementEnabled:false,
    shadowMode:true,
    policyObserveAutomation:65,
    policyThrottlePressure:70,
    policyDecoyRisk:65,
    policyQuarantineRisk:85
  };
}

test('BehaviorEngine records policy evaluations without changing enforcement posture',()=>{
  const profile=newProfile();
  const engine=Object.create(BehaviorEngine.prototype);
  engine.config=config();
  engine.now=()=>1000;
  const first=engine.updatePolicyDecision(profile,1000);
  assert.equal(first.action,'allow');
  assert.equal(profile.policyForensics.evaluations,1);
  profile.manualPolicy='quarantine';
  const second=engine.updatePolicyDecision(profile,2000);
  assert.equal(second.action,'quarantine');
  assert.equal(second.enforcementEligible,false);
  assert.equal(profile.policyForensics.transitions,1);
  assert.equal(profile.policyForensics.highImpactRecommendations,1);
});

test('public profile and observatory expose bounded calibration data',()=>{
  const profile=newProfile();
  const engine=Object.create(BehaviorEngine.prototype);
  engine.config=config();
  engine.now=()=>1000;
  engine.updatePolicyDecision(profile,1000);
  profile.manualPolicy='quarantine';
  engine.updatePolicyDecision(profile,2000);
  const projected=publicProfile('1234567890abcdef',profile);
  assert.equal(projected.policyForensics.evaluations,2);
  const obs=buildAgentTrafficObservatory([projected]);
  assert.equal(obs.policyCalibration.evaluations,2);
  assert.equal(obs.policyCalibration.transitions,1);
  assert.equal(obs.policyCalibration.highImpactRecommendations,1);
  assert.equal(obs.policyCalibration.topReasons.manual_quarantine,1);
  assert.equal(JSON.stringify(obs).includes('1234567890abcdef'),false);
});
