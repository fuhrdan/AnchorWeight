export const AI_AGENT_BURNIN_READINESS_SCHEMA='anchorweight-ai-agent-burnin-readiness/v1';

const REQUIRED_GATES=Object.freeze([
  'controls',
  'verification',
  'verificationPolicy',
  'observability',
  'policyManager',
  'policyDeployment'
]);

function bool(value) {
  return value===true;
}

function blocker(code,detail) {
  return {code,detail};
}

export function buildAiAgentBurnInReadiness(input={}) {
  const blockers=[];
  const gates=input.gates||{};
  for(const name of REQUIRED_GATES) {
    if(!bool(gates[name])) blockers.push(blocker(`gate_${name}_failed`,`${name} gate did not pass.`));
  }

  const canaries=input.canaries||{};
  const expected=Math.max(0,Number(canaries.expected)||0);
  const passed=Math.max(0,Number(canaries.passed)||0);
  if(expected<1 || passed!==expected) blockers.push(blocker('canary_matrix_incomplete',`${passed}/${expected} AI-agent family canaries passed.`));

  if(input.frozenContractHashMatches!==true) blockers.push(blocker('frozen_contract_changed','The frozen v3.0 contract hash does not match the release baseline.'));
  if(input.privacyInvariantsPass!==true) blockers.push(blocker('privacy_invariant_failed','One or more frozen privacy invariants failed.'));
  if(input.policyActionsMatch!==true) blockers.push(blocker('policy_action_contract_changed','The frozen policy action ladder changed.'));
  if(input.shadowDeploymentSafe!==true) blockers.push(blocker('shadow_deployment_safety_failed','The alpha.6 deployment/rollback contract is not shadow-only and non-enforcing.'));
  if(input.dashboardContractPass!==true) blockers.push(blocker('dashboard_contract_failed','Expected AI operator surfaces or safety text are missing.'));
  if(input.runtimeWiringPass!==true) blockers.push(blocker('runtime_wiring_failed','Expected AI runtime/API wiring is missing.'));
  if(input.sourceHygienePass!==true) blockers.push(blocker('source_hygiene_failed','A stale runtime version or release hygiene problem was detected.'));
  if(input.releaseVerificationAvailable!==true) blockers.push(blocker('release_verification_unavailable','Release manifest verification is not wired.'));
  if(input.enforcementEnabled===true) blockers.push(blocker('active_enforcement_detected','Burn-in readiness must not depend on active AI-agent deny enforcement.'));

  return {
    schema:AI_AGENT_BURNIN_READINESS_SCHEMA,
    version:1,
    verdict:blockers.length?'blocked':'ready_for_v3_1_beta_review',
    readyForBetaReview:blockers.length===0,
    blockers,
    gates:Object.fromEntries(REQUIRED_GATES.map(name=>[name,bool(gates[name])])),
    canaries:{expected,passed},
    frozenContractHashMatches:input.frozenContractHashMatches===true,
    privacyInvariantsPass:input.privacyInvariantsPass===true,
    policyActionsMatch:input.policyActionsMatch===true,
    shadowDeploymentSafe:input.shadowDeploymentSafe===true,
    dashboardContractPass:input.dashboardContractPass===true,
    runtimeWiringPass:input.runtimeWiringPass===true,
    sourceHygienePass:input.sourceHygienePass===true,
    releaseVerificationAvailable:input.releaseVerificationAvailable===true,
    enforcementEnabled:input.enforcementEnabled===true,
    enforcementReadinessGranted:false,
    changesRuntime:false
  };
}

export function describeAiAgentBurnInReadiness() {
  return {
    version:1,
    available:true,
    offlineStaticGate:true,
    aggregatesPriorAiGates:true,
    familyCanaries:true,
    frozenContractVerified:true,
    privacyVerified:true,
    shadowDeploymentVerified:true,
    releaseVerificationRequired:true,
    betaReviewVerdict:true,
    enforcementReadinessGranted:false,
    enforcementControlAvailable:false,
    changesRuntime:false,
    networkRequired:false,
    rawIpExposed:false,
    rawUserAgentExposed:false,
    rawPathExposed:false,
    credentialsExposed:false
  };
}
