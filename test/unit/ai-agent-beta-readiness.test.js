import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiAgentBetaReadiness,describeAiAgentBetaReadiness,AI_AGENT_BETA_READINESS_SCHEMA } from '../../src/ai-agent-beta-readiness.js';

function good(overrides={}) {
  return {
    releaseChannel:'beta',
    burnIn:{ok:true,readyForBetaReview:true,blockers:[]},
    frozenContractHashMatches:true,
    privacyInvariantsPass:true,
    shadowSafetyPass:true,
    operatorSurfacePass:true,
    releaseVerificationAvailable:true,
    betaDocumentationComplete:true,
    activeEnforcementControlExposed:false,
    changesRuntime:false,
    ...overrides
  };
}

test('complete stabilization evidence reaches beta validation readiness',()=>{
  const r=buildAiAgentBetaReadiness(good());
  assert.equal(r.schema,AI_AGENT_BETA_READINESS_SCHEMA);
  assert.equal(r.readyForBetaValidation,true);
  assert.equal(r.verdict,'ready_for_v3_1_beta_validation');
  assert.equal(r.blockers.length,0);
  assert.equal(r.enforcementReadinessGranted,false);
});

test('release channel must be beta',()=>{
  const r=buildAiAgentBetaReadiness(good({releaseChannel:'alpha'}));
  assert.ok(r.blockers.some(x=>x.code==='release_channel_not_beta'));
});

test('alpha burn-in remains a mandatory beta prerequisite',()=>{
  const r=buildAiAgentBetaReadiness(good({burnIn:{ok:false,readyForBetaReview:false,blockers:[{code:'x'}]}}));
  assert.ok(r.blockers.some(x=>x.code==='alpha_burnin_failed'));
  assert.ok(r.blockers.some(x=>x.code==='alpha_beta_review_not_ready'));
  assert.ok(r.blockers.some(x=>x.code==='alpha_burnin_blockers_present'));
});

test('frozen contract drift blocks beta validation',()=>{
  const r=buildAiAgentBetaReadiness(good({frozenContractHashMatches:false}));
  assert.ok(r.blockers.some(x=>x.code==='frozen_contract_changed'));
});

test('privacy drift blocks beta validation',()=>{
  const r=buildAiAgentBetaReadiness(good({privacyInvariantsPass:false}));
  assert.ok(r.blockers.some(x=>x.code==='privacy_invariant_failed'));
});

test('shadow-safety drift blocks beta validation',()=>{
  const r=buildAiAgentBetaReadiness(good({shadowSafetyPass:false}));
  assert.ok(r.blockers.some(x=>x.code==='shadow_safety_failed'));
});

test('operator surface drift blocks beta validation',()=>{
  const r=buildAiAgentBetaReadiness(good({operatorSurfacePass:false}));
  assert.ok(r.blockers.some(x=>x.code==='operator_surface_failed'));
});

test('release verification remains mandatory',()=>{
  const r=buildAiAgentBetaReadiness(good({releaseVerificationAvailable:false}));
  assert.ok(r.blockers.some(x=>x.code==='release_verification_unavailable'));
});

test('beta documentation is part of stabilization readiness',()=>{
  const r=buildAiAgentBetaReadiness(good({betaDocumentationComplete:false}));
  assert.ok(r.blockers.some(x=>x.code==='beta_documentation_incomplete'));
});

test('active enforcement control is forbidden in beta.1 stabilization gate',()=>{
  const r=buildAiAgentBetaReadiness(good({activeEnforcementControlExposed:true}));
  assert.ok(r.blockers.some(x=>x.code==='enforcement_control_exposed'));
});

test('beta gate must not mutate runtime',()=>{
  const r=buildAiAgentBetaReadiness(good({changesRuntime:true}));
  assert.ok(r.blockers.some(x=>x.code==='beta_gate_mutates_runtime'));
});

test('beta readiness descriptor is stabilization-only and non-enforcing',()=>{
  const d=describeAiAgentBetaReadiness();
  assert.equal(d.stabilizationOnly,true);
  assert.equal(d.requiresAlphaBurnIn,true);
  assert.equal(d.changesRuntime,false);
  assert.equal(d.networkRequired,false);
  assert.equal(d.enforcementReadinessGranted,false);
  assert.equal(d.enforcementControlAvailable,false);
  assert.equal(d.rawIpExposed,false);
  assert.equal(d.rawUserAgentExposed,false);
  assert.equal(d.rawPathExposed,false);
  assert.equal(d.rawQueryExposed,false);
});
