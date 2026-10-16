import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiAgentGaReadiness,describeAiAgentGaReadiness } from '../../src/ai-agent-ga-readiness.js';

function good(overrides={}) {
  return {
    gaStaticReady:true,
    priorRcGatePassed:true,
    validatedRc1Record:true,
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

test('complete GA evidence reaches stable release readiness without enabling enforcement',()=>{
  const r=buildAiAgentGaReadiness(good());
  assert.equal(r.readyForGaRelease,true);
  assert.equal(r.enforcementReadinessGranted,false);
  assert.equal(r.enforcementControlAvailable,false);
  assert.equal(r.changesRuntime,false);
  assert.equal(r.postDeployValidationRequired,true);
});

test('degraded hosting identity remains warning rather than GA blocker',()=>{
  const r=buildAiAgentGaReadiness(good());
  assert.equal(r.blockers.length,0);
  assert.ok(r.warnings.some(x=>x.code==='client_identity_degraded'));
  assert.ok(r.warnings.some(x=>x.code==='client_identity_not_enforcement_safe'));
});

for(const [field,code] of [
  ['gaStaticReady','ga_static_gate_failed'],
  ['priorRcGatePassed','rc_prerequisite_failed'],
  ['validatedRc1Record','validated_rc1_record_missing'],
  ['frozenContractHashMatches','frozen_contract_changed'],
  ['requestPathUnchanged','request_path_changed'],
  ['privacyInvariantsPass','privacy_contract_failed'],
  ['shadowSafetyPass','shadow_safety_failed'],
  ['productionValidationSemanticsPass','production_validation_semantics_failed'],
  ['releaseVerificationAvailable','release_verification_unavailable'],
  ['documentationComplete','ga_documentation_incomplete']
]) {
  test(`${field} failure blocks GA readiness`,()=>{
    const r=buildAiAgentGaReadiness(good({[field]:false}));
    assert.equal(r.readyForGaRelease,false);
    assert.ok(r.blockers.some(x=>x.code===code));
  });
}

test('enforcement control blocks GA readiness',()=>{
  const r=buildAiAgentGaReadiness(good({enforcementControlAvailable:true}));
  assert.equal(r.readyForGaRelease,false);
  assert.ok(r.blockers.some(x=>x.code==='enforcement_control_present'));
});

test('runtime mutation blocks GA readiness',()=>{
  const r=buildAiAgentGaReadiness(good({changesRuntime:true}));
  assert.equal(r.readyForGaRelease,false);
  assert.ok(r.blockers.some(x=>x.code==='runtime_mutation_present'));
});

test('descriptor is stable, offline, privacy-safe, and still non-enforcing',()=>{
  const d=describeAiAgentGaReadiness();
  assert.equal(d.stableRelease,true);
  assert.equal(d.networkRequired,false);
  assert.equal(d.changesRuntime,false);
  assert.equal(d.enforcementReadinessGranted,false);
  assert.equal(d.enforcementControlAvailable,false);
  assert.equal(d.requiresPostDeployValidation,true);
  assert.equal(d.rawIpExposed,false);
  assert.equal(d.rawUserAgentExposed,false);
  assert.equal(d.credentialsExposed,false);
});
