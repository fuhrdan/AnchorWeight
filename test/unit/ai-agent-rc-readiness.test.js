import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiAgentRcReadiness,describeAiAgentRcReadiness } from '../../src/ai-agent-rc-readiness.js';

function good(overrides={}) {
  return {
    rcStaticReady:true,
    priorBeta2GatePassed:true,
    validatedBaselineRecord:true,
    frozenContractHashMatches:true,
    requestPathUnchanged:true,
    privacyInvariantsPass:true,
    shadowSafetyPass:true,
    productionValidationSemanticsPass:true,
    releaseVerificationAvailable:true,
    documentationComplete:true,
    enforcementControlAvailable:false,
    changesRuntime:false,
    clientIdentityStatus:'degraded',
    clientIdentityEnforcementSafe:false,
    ...overrides
  };
}

test('complete RC evidence reaches RC candidate readiness without GA/enforcement readiness',()=>{
  const r=buildAiAgentRcReadiness(good());
  assert.equal(r.readyForRcCandidate,true);
  assert.equal(r.readyForGa,false);
  assert.equal(r.enforcementReadinessGranted,false);
  assert.equal(r.enforcementControlAvailable,false);
  assert.equal(r.changesRuntime,false);
});

test('degraded hosting identity remains warning not RC blocker',()=>{
  const r=buildAiAgentRcReadiness(good());
  assert.ok(r.warnings.some(x=>x.code==='client_identity_degraded'));
  assert.ok(r.warnings.some(x=>x.code==='client_identity_not_enforcement_safe'));
  assert.equal(r.blockers.length,0);
});

for(const [field,code] of [
  ['rcStaticReady','rc_static_gate_failed'],
  ['priorBeta2GatePassed','beta2_prerequisite_failed'],
  ['validatedBaselineRecord','validated_baseline_missing'],
  ['frozenContractHashMatches','frozen_contract_changed'],
  ['requestPathUnchanged','request_path_changed'],
  ['privacyInvariantsPass','privacy_contract_failed'],
  ['shadowSafetyPass','shadow_safety_failed'],
  ['productionValidationSemanticsPass','production_validation_semantics_failed'],
  ['releaseVerificationAvailable','release_verification_unavailable'],
  ['documentationComplete','rc_documentation_incomplete']
]) {
  test(`${field} failure blocks RC readiness`,()=>{
    const r=buildAiAgentRcReadiness(good({[field]:false}));
    assert.equal(r.readyForRcCandidate,false);
    assert.ok(r.blockers.some(x=>x.code===code));
  });
}

test('enforcement control blocks RC readiness',()=>{
  const r=buildAiAgentRcReadiness(good({enforcementControlAvailable:true}));
  assert.equal(r.readyForRcCandidate,false);
  assert.ok(r.blockers.some(x=>x.code==='enforcement_control_present'));
});

test('runtime mutation blocks RC readiness',()=>{
  const r=buildAiAgentRcReadiness(good({changesRuntime:true}));
  assert.equal(r.readyForRcCandidate,false);
  assert.ok(r.blockers.some(x=>x.code==='runtime_mutation_present'));
});

test('descriptor remains offline, privacy-safe and non-enforcing',()=>{
  const d=describeAiAgentRcReadiness();
  assert.equal(d.stabilizationOnly,true);
  assert.equal(d.networkRequired,false);
  assert.equal(d.changesRuntime,false);
  assert.equal(d.enforcementReadinessGranted,false);
  assert.equal(d.enforcementControlAvailable,false);
  assert.equal(d.rawIpExposed,false);
  assert.equal(d.rawUserAgentExposed,false);
  assert.equal(d.credentialsExposed,false);
});
