import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentPassport } from '../../src/agent-passport.js';
import { ANCHORWEIGHT_VERSION,ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';

test('RC.1 Agent Passport publishes additive RC readiness without enabling enforcement',()=>{
  assert.equal(ANCHORWEIGHT_VERSION,'3.1.0');
  assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'stable');
  const p=createAgentPassport({
    shadowMode:true,
    scoreEnforcementEnabled:false,
    policyEngineEnabled:true,
    policyEngineShadowMode:true,
    policyEngineEnforcementEnabled:false,
    aiAgentPolicyEnabled:true,
    aiAgentPolicyShadowMode:true,
    aiAgentPolicyEnforcementEnabled:false
  });
  assert.equal(p.capabilities.aiAgentControls.version,11);
  assert.equal(p.capabilities.aiAgentControls.rcReadiness.available,true);
  assert.equal(p.capabilities.aiAgentControls.rcReadiness.enforcementReadinessGranted,false);
  assert.equal(p.capabilities.aiAgentControls.rcReadiness.enforcementControlAvailable,false);
  assert.equal(p.capabilities.aiAgentControls.productionValidation.restartComparisonRequiredForRcReview,true);
  assert.equal(p.enforcement.aiAgentPolicyEnforced,false);
  assert.equal(p.privacy.rawIpExposed,false);
  assert.equal(p.privacy.rawUserAgentExposed,false);
});
