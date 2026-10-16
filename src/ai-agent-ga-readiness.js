export const AI_AGENT_GA_READINESS_SCHEMA='anchorweight-ai-agent-ga-readiness/v1';

function blocker(code,detail) {
  return {code,detail};
}

function warning(code,detail) {
  return {code,detail};
}

export function describeAiAgentGaReadiness() {
  return {
    version:1,
    available:true,
    stableRelease:true,
    requiresValidatedRc1:true,
    requiresFrozenContract:true,
    requiresUnchangedRequestPath:true,
    requiresPrivacyContract:true,
    requiresShadowSafety:true,
    requiresProductionValidationSemantics:true,
    requiresReleaseVerification:true,
    requiresPostDeployValidation:true,
    gaReleaseVerdict:true,
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

export function buildAiAgentGaReadiness(input={}) {
  const blockers=[];
  const warnings=[];

  if(input.gaStaticReady!==true) blockers.push(blocker('ga_static_gate_failed','The v3.1 GA static gate did not pass.'));
  if(input.priorRcGatePassed!==true) blockers.push(blocker('rc_prerequisite_failed','The RC.1 prerequisite gate is not green.'));
  if(input.validatedRc1Record!==true) blockers.push(blocker('validated_rc1_record_missing','The validated RC.1 production/burn-in record is missing or invalid.'));
  if(input.frozenContractHashMatches!==true) blockers.push(blocker('frozen_contract_changed','The frozen v3 contract hash changed.'));
  if(input.requestPathUnchanged!==true) blockers.push(blocker('request_path_changed','A critical AI request-path source file changed after validated RC.1.'));
  if(input.privacyInvariantsPass!==true) blockers.push(blocker('privacy_contract_failed','AI privacy invariants are not intact.'));
  if(input.shadowSafetyPass!==true) blockers.push(blocker('shadow_safety_failed','Shadow-first/no-enforcement defaults changed.'));
  if(input.productionValidationSemanticsPass!==true) blockers.push(blocker('production_validation_semantics_failed','Production validation safety semantics changed.'));
  if(input.releaseVerificationAvailable!==true) blockers.push(blocker('release_verification_unavailable','Release manifest verification is unavailable.'));
  if(input.documentationComplete!==true) blockers.push(blocker('ga_documentation_incomplete','GA documentation/artifacts are incomplete.'));
  if(input.enforcementControlAvailable===true) blockers.push(blocker('enforcement_control_present','GA must not silently expose an AI enforcement control.'));
  if(input.changesRuntime===true) blockers.push(blocker('runtime_mutation_present','GA readiness must remain non-mutating.'));

  if(input.clientIdentityStatus==='degraded') warnings.push(warning('client_identity_degraded','Client identity is degraded; provider verification/client-scoped enforcement remains constrained.'));
  if(input.clientIdentityEnforcementSafe===false) warnings.push(warning('client_identity_not_enforcement_safe','Client-scoped enforcement remains fail-safe disabled.'));

  const readyForGaRelease=blockers.length===0;
  return {
    schema:AI_AGENT_GA_READINESS_SCHEMA,
    verdict:readyForGaRelease?'ready_for_v3_1_ga_release':'blocked',
    readyForGaRelease,
    blockers,
    warnings,
    enforcementReadinessGranted:false,
    enforcementControlAvailable:false,
    changesRuntime:false,
    postDeployValidationRequired:true
  };
}
