export const AI_AGENT_BETA_READINESS_SCHEMA='anchorweight-ai-agent-beta-readiness/v1';

function blocker(code,detail) {
  return {code,detail};
}

export function buildAiAgentBetaReadiness(input={}) {
  const blockers=[];
  const burnIn=input.burnIn||{};

  if(input.releaseChannel!=='beta') blockers.push(blocker('release_channel_not_beta','The v3.1 beta gate requires release channel beta.'));
  if(burnIn.ok!==true) blockers.push(blocker('alpha_burnin_failed','The alpha.7 burn-in prerequisite did not pass.'));
  if(burnIn.readyForBetaReview!==true) blockers.push(blocker('alpha_beta_review_not_ready','The alpha.7 readiness verdict is not beta-review ready.'));
  if((burnIn.blockers||[]).length) blockers.push(blocker('alpha_burnin_blockers_present','The alpha.7 burn-in report still contains blockers.'));
  if(input.frozenContractHashMatches!==true) blockers.push(blocker('frozen_contract_changed','The frozen v3.0 contract hash changed.'));
  if(input.privacyInvariantsPass!==true) blockers.push(blocker('privacy_invariant_failed','One or more frozen privacy invariants changed.'));
  if(input.shadowSafetyPass!==true) blockers.push(blocker('shadow_safety_failed','Policy manager/deployment no longer preserve shadow-first, non-enforcing behavior.'));
  if(input.operatorSurfacePass!==true) blockers.push(blocker('operator_surface_failed','Expected dashboard/operator safety controls are missing.'));
  if(input.releaseVerificationAvailable!==true) blockers.push(blocker('release_verification_unavailable','Source-manifest release verification is unavailable.'));
  if(input.betaDocumentationComplete!==true) blockers.push(blocker('beta_documentation_incomplete','Required beta validation/release documentation is incomplete.'));
  if(input.activeEnforcementControlExposed===true) blockers.push(blocker('enforcement_control_exposed','Beta.1 must not add an active-enforcement control.'));
  if(input.changesRuntime===true) blockers.push(blocker('beta_gate_mutates_runtime','The beta readiness gate must not mutate runtime state.'));

  return {
    schema:AI_AGENT_BETA_READINESS_SCHEMA,
    version:1,
    verdict:blockers.length?'blocked':'ready_for_v3_1_beta_validation',
    readyForBetaValidation:blockers.length===0,
    blockers,
    releaseChannel:input.releaseChannel||null,
    alphaBurnInPassed:burnIn.ok===true,
    alphaBetaReviewReady:burnIn.readyForBetaReview===true,
    frozenContractHashMatches:input.frozenContractHashMatches===true,
    privacyInvariantsPass:input.privacyInvariantsPass===true,
    shadowSafetyPass:input.shadowSafetyPass===true,
    operatorSurfacePass:input.operatorSurfacePass===true,
    releaseVerificationAvailable:input.releaseVerificationAvailable===true,
    betaDocumentationComplete:input.betaDocumentationComplete===true,
    enforcementReadinessGranted:false,
    enforcementControlAvailable:false,
    changesRuntime:false
  };
}

export function describeAiAgentBetaReadiness() {
  return {
    version:1,
    available:true,
    stabilizationOnly:true,
    requiresAlphaBurnIn:true,
    requiresFrozenContract:true,
    requiresPrivacyContract:true,
    requiresShadowSafety:true,
    requiresReleaseVerification:true,
    betaValidationVerdict:true,
    enforcementReadinessGranted:false,
    enforcementControlAvailable:false,
    changesRuntime:false,
    networkRequired:false,
    rawIpExposed:false,
    rawUserAgentExposed:false,
    rawPathExposed:false,
    rawQueryExposed:false,
    credentialsExposed:false
  };
}
