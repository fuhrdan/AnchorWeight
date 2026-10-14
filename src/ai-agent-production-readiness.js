export const AI_AGENT_PRODUCTION_READINESS_SCHEMA='anchorweight-ai-agent-production-readiness/v1';

function blocker(code,detail) {
  return {code,detail};
}

export function buildAiAgentProductionReadiness(input={}) {
  const blockers=[];
  const warnings=[];

  if(input.beta2StaticReady!==true) blockers.push(blocker('beta2_static_gate_failed','The beta.2 offline stabilization gate did not pass.'));
  if(input.liveVersionMatches!==true) blockers.push(blocker('live_version_mismatch','The deployed /live version does not match beta.2.'));
  if(input.liveShadowMode!==true) blockers.push(blocker('live_not_shadow_mode','Production shadow validation requires global shadow mode.'));
  if(input.aiEnforcementDisabled!==true) blockers.push(blocker('ai_enforcement_enabled','Active AI-agent deny enforcement must remain disabled during beta.2 validation.'));
  if(input.passportValid!==true) blockers.push(blocker('agent_passport_invalid','The public Agent Passport did not match the beta.2 contract.'));
  if(input.robotsPolicyAccessible!==true) blockers.push(blocker('robots_policy_blocked','/robots.txt was blocked by AI policy or failed server-side.'));
  if(input.browserUnaffected!==true) blockers.push(blocker('browser_request_blocked','A normal browser canary was unexpectedly denied.'));
  if(input.canariesPassed!==input.canariesExpected || !(Number(input.canariesExpected)>0))
    blockers.push(blocker('ai_canary_matrix_failed',`${Number(input.canariesPassed)||0}/${Number(input.canariesExpected)||0} live AI-agent canaries passed.`));
  if(input.authenticatedChecksRequested===true && input.authenticatedChecksPassed!==true)
    blockers.push(blocker('authenticated_operator_checks_failed','Authenticated AI operator API validation failed.'));
  if(input.privacyChecksPassed!==true) blockers.push(blocker('production_privacy_check_failed','Production AI API/passport privacy checks failed.'));
  if(input.clientIdentityStatus==='degraded')
    warnings.push({code:'client_identity_degraded',detail:'Client identity is degraded; provider verification/client-scoped enforcement remains constrained.'});
  if(input.clientIdentityEnforcementSafe===false)
    warnings.push({code:'client_identity_not_enforcement_safe',detail:'Client-scoped enforcement remains fail-safe disabled.'});
  if(input.restartComparisonRequested===true && input.restartComparisonPassed!==true)
    blockers.push(blocker('restart_persistence_check_failed','The optional post-restart persistence comparison failed.'));

  const livePass=blockers.length===0;
  const fullRcEvidence=livePass &&
    input.authenticatedChecksRequested===true &&
    input.authenticatedChecksPassed===true &&
    input.restartComparisonRequested===true &&
    input.restartComparisonPassed===true;

  return {
    schema:AI_AGENT_PRODUCTION_READINESS_SCHEMA,
    version:1,
    verdict:!livePass?'blocked':fullRcEvidence?'ready_for_v3_1_rc_review':'production_shadow_validation_passed',
    productionShadowValidated:livePass,
    readyForRcReview:fullRcEvidence,
    blockers,
    warnings,
    canaries:{expected:Number(input.canariesExpected)||0,passed:Number(input.canariesPassed)||0},
    authenticatedChecksRequested:input.authenticatedChecksRequested===true,
    authenticatedChecksPassed:input.authenticatedChecksPassed===true,
    restartComparisonRequested:input.restartComparisonRequested===true,
    restartComparisonPassed:input.restartComparisonPassed===true,
    clientIdentityStatus:input.clientIdentityStatus||null,
    clientIdentityEnforcementSafe:input.clientIdentityEnforcementSafe===true,
    enforcementReadinessGranted:false,
    enforcementControlAvailable:false,
    changesRuntime:false
  };
}

export function describeAiAgentProductionReadiness() {
  return {
    version:1,
    available:true,
    liveShadowValidation:true,
    publicCanaries:true,
    authenticatedOperatorChecks:true,
    restartComparisonAvailable:true,
    restartComparisonRequiredForRcReview:true,
    automaticRestart:false,
    automaticActivation:false,
    enforcementReadinessGranted:false,
    enforcementControlAvailable:false,
    changesRuntime:false,
    writesHostingConfiguration:false,
    dashboardTokenFromEnvironmentOnly:true,
    rawIpExposed:false,
    rawUserAgentExposed:false,
    rawPathExposed:false,
    rawQueryExposed:false,
    credentialsExposed:false
  };
}
