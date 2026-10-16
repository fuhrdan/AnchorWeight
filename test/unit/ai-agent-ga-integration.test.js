import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentPassport } from '../../src/agent-passport.js';
import { ANCHORWEIGHT_VERSION,ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';

test('v3.1.0 GA Agent Passport publishes stable GA readiness without enabling AI enforcement',()=>{
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
  assert.equal(p.capabilities.aiAgentControls.gaReadiness.available,true);
  assert.equal(p.capabilities.aiAgentControls.gaReadiness.stableRelease,true);
  assert.equal(p.capabilities.aiAgentControls.gaReadiness.enforcementReadinessGranted,false);
  assert.equal(p.capabilities.aiAgentControls.gaReadiness.enforcementControlAvailable,false);
  assert.equal(p.capabilities.aiAgentControls.gaReadiness.requiresPostDeployValidation,true);
  assert.equal(p.capabilities.aiAgentControls.rcReadiness.available,true);
  assert.equal(p.enforcement.aiAgentPolicyEnforced,false);
  assert.equal(p.privacy.rawIpExposed,false);
  assert.equal(p.privacy.rawUserAgentExposed,false);
});
