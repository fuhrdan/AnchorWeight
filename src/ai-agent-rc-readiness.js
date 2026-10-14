export const AI_AGENT_RC_READINESS_SCHEMA='anchorweight-ai-agent-rc-readiness/v1';

function blocker(code,detail) {
  return {code,detail};
}

function warning(code,detail) {
  return {code,detail};
}

export function describeAiAgentRcReadiness() {
  return {
    version:1,
    available:true,
    stabilizationOnly:true,
    requiresValidatedBeta2:true,
    requiresFrozenContract:true,
    requiresUnchangedRequestPath:true,
    requiresPrivacyContract:true,
    requiresShadowSafety:true,
    requiresProductionValidationSemantics:true,
    requiresReleaseVerification:true,
    rcCandidateVerdict:true,
    gaReadinessGranted:false,
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

export function buildAiAgentRcReadiness(input={}) {
  const blockers=[];
  const warnings=[];

  if(input.rcStaticReady!==true)
    blockers.push(blocker('rc_static_gate_failed','RC.1 static/source gate did not pass.'));
  if(input.priorBeta2GatePassed!==true)
    blockers.push(blocker('beta2_prerequisite_failed','The validated beta.2 stabilization gate is not green.'));
  if(input.validatedBaselineRecord!==true)
    blockers.push(blocker('validated_baseline_missing','The beta.2 validated production evidence record is missing or invalid.'));
  if(input.frozenContractHashMatches!==true)
    blockers.push(blocker('frozen_contract_changed','The frozen v3 contract hash changed.'));
  if(input.requestPathUnchanged!==true)
    blockers.push(blocker('request_path_changed','A critical AI request-path source file changed after validated beta.2.'));
  if(input.privacyInvariantsPass!==true)
    blockers.push(blocker('privacy_contract_failed','AI privacy invariants are not intact.'));
  if(input.shadowSafetyPass!==true)
    blockers.push(blocker('shadow_safety_failed','Shadow-first/no-enforcement safety invariants changed.'));
  if(input.productionValidationSemanticsPass!==true)
    blockers.push(blocker('production_validation_semantics_failed','Production validation safety semantics changed.'));
  if(input.releaseVerificationAvailable!==true)
    blockers.push(blocker('release_verification_unavailable','Release manifest verification is unavailable.'));
  if(input.documentationComplete!==true)
    blockers.push(blocker('rc_documentation_incomplete','RC.1 documentation/artifacts are incomplete.'));
  if(input.enforcementControlAvailable===true)
    blockers.push(blocker('enforcement_control_present','RC.1 must not expose an AI enforcement control.'));
  if(input.changesRuntime===true)
    blockers.push(blocker('runtime_mutation_present','RC.1 readiness must remain non-mutating.'));

  if(input.clientIdentityStatus==='degraded')
    warnings.push(warning('client_identity_degraded','Client identity remains degraded; provider verification/client-scoped enforcement is constrained.'));
  if(input.clientIdentityEnforcementSafe===false)
    warnings.push(warning('client_identity_not_enforcement_safe','Client-scoped enforcement remains fail-safe disabled.'));

  const readyForRcCandidate=blockers.length===0;
  return {
    schema:AI_AGENT_RC_READINESS_SCHEMA,
    verdict:readyForRcCandidate?'ready_for_v3_1_rc_candidate':'blocked',
    readyForRcCandidate,
    readyForGa:false,
    blockers,
    warnings,
    enforcementReadinessGranted:false,
    enforcementControlAvailable:false,
    changesRuntime:false
  };
}
