import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiAgentProductionReadiness,describeAiAgentProductionReadiness,AI_AGENT_PRODUCTION_READINESS_SCHEMA } from '../../src/ai-agent-production-readiness.js';

function good(overrides={}) {
  return {
    beta2StaticReady:true,liveVersionMatches:true,liveShadowMode:true,aiEnforcementDisabled:true,
    passportValid:true,robotsPolicyAccessible:true,browserUnaffected:true,canariesExpected:12,canariesPassed:12,
    authenticatedChecksRequested:true,authenticatedChecksPassed:true,privacyChecksPassed:true,
    clientIdentityStatus:'degraded',clientIdentityEnforcementSafe:false,
    restartComparisonRequested:true,restartComparisonPassed:true,
    ...overrides
  };
}

test('complete production shadow evidence reaches RC review',()=>{
  const r=buildAiAgentProductionReadiness(good());
  assert.equal(r.schema,AI_AGENT_PRODUCTION_READINESS_SCHEMA);
  assert.equal(r.productionShadowValidated,true);
  assert.equal(r.readyForRcReview,true);
  assert.equal(r.verdict,'ready_for_v3_1_rc_review');
  assert.equal(r.enforcementReadinessGranted,false);
});

test('HawkHost degraded client identity is surfaced as warning',()=>{
  const r=buildAiAgentProductionReadiness(good());
  assert.ok(r.warnings.some(x=>x.code==='client_identity_degraded'));
  assert.ok(r.warnings.some(x=>x.code==='client_identity_not_enforcement_safe'));
  assert.equal(r.blockers.length,0);
});

test('active AI enforcement blocks production shadow validation',()=>{
  const r=buildAiAgentProductionReadiness(good({aiEnforcementDisabled:false}));
  assert.equal(r.productionShadowValidated,false);
  assert.ok(r.blockers.some(x=>x.code==='ai_enforcement_enabled'));
});

test('global shadow mode is mandatory',()=>{
  const r=buildAiAgentProductionReadiness(good({liveShadowMode:false}));
  assert.ok(r.blockers.some(x=>x.code==='live_not_shadow_mode'));
});

test('live version mismatch blocks validation',()=>{
  const r=buildAiAgentProductionReadiness(good({liveVersionMatches:false}));
  assert.ok(r.blockers.some(x=>x.code==='live_version_mismatch'));
});

test('public passport and robots policy accessibility remain mandatory',()=>{
  const r=buildAiAgentProductionReadiness(good({passportValid:false,robotsPolicyAccessible:false}));
  assert.ok(r.blockers.some(x=>x.code==='agent_passport_invalid'));
  assert.ok(r.blockers.some(x=>x.code==='robots_policy_blocked'));
});

test('normal browser traffic must remain unaffected',()=>{
  const r=buildAiAgentProductionReadiness(good({browserUnaffected:false}));
  assert.ok(r.blockers.some(x=>x.code==='browser_request_blocked'));
});

test('all 12 live canaries are required',()=>{
  const r=buildAiAgentProductionReadiness(good({canariesPassed:11}));
  assert.ok(r.blockers.some(x=>x.code==='ai_canary_matrix_failed'));
});

test('authenticated operator checks are required when requested',()=>{
  const r=buildAiAgentProductionReadiness(good({authenticatedChecksPassed:false}));
  assert.ok(r.blockers.some(x=>x.code==='authenticated_operator_checks_failed'));
});

test('privacy check failure blocks validation',()=>{
  const r=buildAiAgentProductionReadiness(good({privacyChecksPassed:false}));
  assert.ok(r.blockers.some(x=>x.code==='production_privacy_check_failed'));
});

test('restart comparison failure blocks full validation when requested',()=>{
  const r=buildAiAgentProductionReadiness(good({restartComparisonPassed:false}));
  assert.ok(r.blockers.some(x=>x.code==='restart_persistence_check_failed'));
});


test('authenticated live validation without restart evidence does not claim RC review',()=>{
  const r=buildAiAgentProductionReadiness(good({restartComparisonRequested:false,restartComparisonPassed:false}));
  assert.equal(r.productionShadowValidated,true);
  assert.equal(r.readyForRcReview,false);
  assert.equal(r.verdict,'production_shadow_validation_passed');
});

test('public-only validation can pass without claiming RC-review completeness',()=>{
  const r=buildAiAgentProductionReadiness(good({
    authenticatedChecksRequested:false,authenticatedChecksPassed:false,
    restartComparisonRequested:false,restartComparisonPassed:false
  }));
  assert.equal(r.productionShadowValidated,true);
  assert.equal(r.readyForRcReview,false);
  assert.equal(r.verdict,'production_shadow_validation_passed');
});

test('descriptor is read-only and never exposes enforcement control or secrets',()=>{
  const d=describeAiAgentProductionReadiness();
  assert.equal(d.automaticRestart,false);
  assert.equal(d.automaticActivation,false);
  assert.equal(d.enforcementControlAvailable,false);
  assert.equal(d.changesRuntime,false);
  assert.equal(d.writesHostingConfiguration,false);
  assert.equal(d.dashboardTokenFromEnvironmentOnly,true);
  assert.equal(d.restartComparisonAvailable,true);
  assert.equal(d.restartComparisonRequiredForRcReview,true);
  assert.equal(d.rawIpExposed,false);
  assert.equal(d.rawUserAgentExposed,false);
  assert.equal(d.credentialsExposed,false);
});
