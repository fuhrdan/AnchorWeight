import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiAgentBurnInReadiness,describeAiAgentBurnInReadiness,AI_AGENT_BURNIN_READINESS_SCHEMA } from '../../src/ai-agent-burnin-readiness.js';

function good(overrides={}) {
  return {
    gates:{controls:true,verification:true,verificationPolicy:true,observability:true,policyManager:true,policyDeployment:true},
    canaries:{expected:12,passed:12},
    frozenContractHashMatches:true,
    privacyInvariantsPass:true,
    policyActionsMatch:true,
    shadowDeploymentSafe:true,
    dashboardContractPass:true,
    runtimeWiringPass:true,
    sourceHygienePass:true,
    releaseVerificationAvailable:true,
    enforcementEnabled:false,
    ...overrides
  };
}

test('complete burn-in evidence reaches beta-review readiness',()=>{
  const r=buildAiAgentBurnInReadiness(good());
  assert.equal(r.schema,AI_AGENT_BURNIN_READINESS_SCHEMA);
  assert.equal(r.readyForBetaReview,true);
  assert.equal(r.verdict,'ready_for_v3_1_beta_review');
  assert.equal(r.blockers.length,0);
  assert.equal(r.enforcementReadinessGranted,false);
});

test('any prior AI gate failure blocks beta review',()=>{
  const r=buildAiAgentBurnInReadiness(good({gates:{...good().gates,verification:false}}));
  assert.equal(r.readyForBetaReview,false);
  assert.ok(r.blockers.some(x=>x.code==='gate_verification_failed'));
});

test('incomplete family canary matrix blocks beta review',()=>{
  const r=buildAiAgentBurnInReadiness(good({canaries:{expected:12,passed:11}}));
  assert.ok(r.blockers.some(x=>x.code==='canary_matrix_incomplete'));
});

test('frozen contract drift blocks beta review',()=>{
  const r=buildAiAgentBurnInReadiness(good({frozenContractHashMatches:false}));
  assert.ok(r.blockers.some(x=>x.code==='frozen_contract_changed'));
});

test('privacy drift blocks beta review',()=>{
  const r=buildAiAgentBurnInReadiness(good({privacyInvariantsPass:false}));
  assert.ok(r.blockers.some(x=>x.code==='privacy_invariant_failed'));
});

test('policy action drift blocks beta review',()=>{
  const r=buildAiAgentBurnInReadiness(good({policyActionsMatch:false}));
  assert.ok(r.blockers.some(x=>x.code==='policy_action_contract_changed'));
});

test('unsafe shadow deployment contract blocks beta review',()=>{
  const r=buildAiAgentBurnInReadiness(good({shadowDeploymentSafe:false}));
  assert.ok(r.blockers.some(x=>x.code==='shadow_deployment_safety_failed'));
});

test('dashboard or runtime wiring drift blocks beta review',()=>{
  const r=buildAiAgentBurnInReadiness(good({dashboardContractPass:false,runtimeWiringPass:false}));
  assert.ok(r.blockers.some(x=>x.code==='dashboard_contract_failed'));
  assert.ok(r.blockers.some(x=>x.code==='runtime_wiring_failed'));
});

test('source hygiene and release verification remain mandatory',()=>{
  const r=buildAiAgentBurnInReadiness(good({sourceHygienePass:false,releaseVerificationAvailable:false}));
  assert.ok(r.blockers.some(x=>x.code==='source_hygiene_failed'));
  assert.ok(r.blockers.some(x=>x.code==='release_verification_unavailable'));
});

test('active enforcement never qualifies as alpha.7 burn-in readiness',()=>{
  const r=buildAiAgentBurnInReadiness(good({enforcementEnabled:true}));
  assert.equal(r.readyForBetaReview,false);
  assert.ok(r.blockers.some(x=>x.code==='active_enforcement_detected'));
});

test('burn-in descriptor is offline, non-mutating and non-enforcing',()=>{
  const d=describeAiAgentBurnInReadiness();
  assert.equal(d.offlineStaticGate,true);
  assert.equal(d.networkRequired,false);
  assert.equal(d.changesRuntime,false);
  assert.equal(d.enforcementReadinessGranted,false);
  assert.equal(d.enforcementControlAvailable,false);
  assert.equal(d.rawIpExposed,false);
  assert.equal(d.rawUserAgentExposed,false);
});
