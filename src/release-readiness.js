export const RELEASE_READINESS_MAX_PROFILES = 500;
export const RELEASE_READINESS_MIN_POLICY_EVALUATIONS = 100;
export const RELEASE_READINESS_MIN_LABELED = 10;
export const RELEASE_READINESS_MIN_PER_CLASS = 3;

const REVIEW_CONFIRMED = 'confirmed_automation';
const REVIEW_FALSE_POSITIVE = 'false_positive';

function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Math.round(n(value))));
}

function configured(config, key, fallback) {
  const value = Math.round(Number(config?.[key]));
  return Number.isFinite(value) ? Math.max(1, Math.min(100, value)) : fallback;
}

function score(profile, key) {
  return boundedScore(profile?.trafficScores?.[key]?.score);
}

function reviewStatus(profile) {
  return String(profile?.review?.status || 'unreviewed').slice(0, 32);
}

function currentThresholds(config = {}) {
  return {
    observeAutomation: configured(config, 'policyObserveAutomation', 65),
    throttlePressure: configured(config, 'policyThrottlePressure', 70),
    decoyRisk: configured(config, 'policyDecoyRisk', 65),
    quarantineRisk: configured(config, 'policyQuarantineRisk', 85)
  };
}

function separatedSuggestion(falseProfiles, confirmedProfiles, dimension, current) {
  const falseScores = falseProfiles.map(p => score(p, dimension));
  const confirmedScores = confirmedProfiles.map(p => score(p, dimension));
  if (!falseScores.length || !confirmedScores.length) {
    return { current, suggested:current, status:'insufficient_evidence', separation:null };
  }
  const falseMax = Math.max(...falseScores);
  const confirmedMin = Math.min(...confirmedScores);
  const separation = confirmedMin - falseMax;
  if (separation < 5) {
    return {
      current,
      suggested:current,
      status:'overlap_hold',
      separation,
      evidence:{ falsePositiveMax:falseMax, confirmedAutomationMin:confirmedMin }
    };
  }
  const suggested = Math.max(1, Math.min(100, Math.round((falseMax + confirmedMin) / 2)));
  return {
    current,
    suggested,
    status:'separated_candidate',
    separation,
    evidence:{ falsePositiveMax:falseMax, confirmedAutomationMin:confirmedMin }
  };
}

function corroborated(profile) {
  return n(profile?.blackholeVisits) > 0 || n(profile?.invalidTraversals) >= 2 || n(profile?.proofOfCrawl) > 0;
}

export function analyzePolicyCalibration(publicProfiles = [], config = {}) {
  const sample = (Array.isArray(publicProfiles) ? publicProfiles.filter(Boolean) : [])
    .slice(0, RELEASE_READINESS_MAX_PROFILES);
  const falsePositives = sample.filter(p => reviewStatus(p) === REVIEW_FALSE_POSITIVE);
  const confirmed = sample.filter(p => reviewStatus(p) === REVIEW_CONFIRMED);
  const labeled = falsePositives.length + confirmed.length;
  const sufficientLabeledEvidence = labeled >= RELEASE_READINESS_MIN_LABELED &&
    falsePositives.length >= RELEASE_READINESS_MIN_PER_CLASS &&
    confirmed.length >= RELEASE_READINESS_MIN_PER_CLASS;
  const current = currentThresholds(config);

  const recommendations = {
    observeAutomation: { current:current.observeAutomation, suggested:current.observeAutomation, status:'insufficient_evidence' },
    throttlePressure: { current:current.throttlePressure, suggested:current.throttlePressure, status:'insufficient_evidence' },
    decoyRisk: { current:current.decoyRisk, suggested:current.decoyRisk, status:'insufficient_evidence' },
    quarantineRisk: { current:current.quarantineRisk, suggested:current.quarantineRisk, status:'corroboration_required' }
  };

  if (sufficientLabeledEvidence) {
    recommendations.observeAutomation = separatedSuggestion(falsePositives, confirmed, 'automationConfidence', current.observeAutomation);
    recommendations.throttlePressure = separatedSuggestion(falsePositives, confirmed, 'resourcePressure', current.throttlePressure);
    recommendations.decoyRisk = separatedSuggestion(falsePositives, confirmed, 'policyRisk', current.decoyRisk);

    const corroboratedConfirmed = confirmed.filter(corroborated);
    if (corroboratedConfirmed.length >= RELEASE_READINESS_MIN_PER_CLASS) {
      const q = separatedSuggestion(falsePositives, corroboratedConfirmed, 'policyRisk', current.quarantineRisk);
      const floor = Math.min(100, Math.max(recommendations.decoyRisk.suggested + 10, 1));
      recommendations.quarantineRisk = {
        ...q,
        suggested: q.status === 'separated_candidate' ? Math.max(floor, q.suggested) : current.quarantineRisk,
        status: q.status === 'separated_candidate' ? 'corroborated_candidate' : 'corroboration_overlap_hold',
        corroboratedConfirmed: corroboratedConfirmed.length
      };
    }
  }

  const candidate = {
    observeAutomation: recommendations.observeAutomation.suggested,
    throttlePressure: recommendations.throttlePressure.suggested,
    decoyRisk: recommendations.decoyRisk.suggested,
    quarantineRisk: Math.max(recommendations.quarantineRisk.suggested, recommendations.decoyRisk.suggested)
  };

  return {
    version:1,
    advisoryOnly:true,
    sampledProfiles:sample.length,
    labeledProfiles:labeled,
    confirmedAutomation:confirmed.length,
    falsePositive:falsePositives.length,
    needsReview:sample.filter(p => reviewStatus(p) === 'needs_review').length,
    inconclusive:sample.filter(p => reviewStatus(p) === 'inconclusive').length,
    sufficientLabeledEvidence,
    minimumEvidence:{
      labeled:RELEASE_READINESS_MIN_LABELED,
      perClass:RELEASE_READINESS_MIN_PER_CLASS
    },
    current,
    candidate,
    recommendations
  };
}

export function buildReleaseReadiness({
  config = {},
  clientIdentity = {},
  publicProfiles = [],
  agentObservatory = {},
  totalProfiles = null
} = {}) {
  const calibration = analyzePolicyCalibration(publicProfiles, config);
  const evaluations = Math.round(n(agentObservatory?.policyCalibration?.evaluations));
  const highImpactRecommendations = Math.round(n(agentObservatory?.policyCalibration?.highImpactRecommendations));
  const highImpactRate = evaluations ? Math.round((highImpactRecommendations / evaluations) * 100) : 0;
  const identitySafe = !!clientIdentity?.enforcementSafe && clientIdentity?.status === 'trusted';
  const proxyProtected = !!config.proxyEnabled;
  const policyEnabled = config.policyEngineEnabled !== false;
  const shadowValidated = config.shadowMode !== false && config.policyEngineShadowMode !== false;
  const enoughObservations = evaluations >= RELEASE_READINESS_MIN_POLICY_EVALUATIONS;
  const impactStable = evaluations > 0 && highImpactRate <= 25;

  const checks = [
    {
      id:'client_identity',
      status:identitySafe ? 'pass' : 'fail',
      blocking:true,
      detail:identitySafe ? 'Client identity is trusted for client-scoped enforcement.' : `Client identity is not enforcement-safe (${String(clientIdentity?.reason || clientIdentity?.status || 'unavailable').slice(0,64)}).`
    },
    {
      id:'protected_traffic_path',
      status:proxyProtected ? 'pass' : 'fail',
      blocking:true,
      detail:proxyProtected ? 'Reverse proxy protection is enabled.' : 'Reverse proxy protection is disabled; whole-site enforcement is not active.'
    },
    {
      id:'policy_engine',
      status:policyEnabled ? 'pass' : 'fail',
      blocking:true,
      detail:policyEnabled ? 'Policy Engine is enabled for evaluation.' : 'Policy Engine is disabled.'
    },
    {
      id:'shadow_validation',
      status:shadowValidated ? 'pass' : 'warn',
      blocking:false,
      detail:shadowValidated ? 'Global and Policy Engine shadow modes are active.' : 'One or more shadow gates are already disabled.'
    },
    {
      id:'policy_observation_volume',
      status:enoughObservations ? 'pass' : 'warn',
      blocking:false,
      detail:`${evaluations} policy evaluations observed; ${RELEASE_READINESS_MIN_POLICY_EVALUATIONS} recommended before enforcement review.`
    },
    {
      id:'analyst_labels',
      status:calibration.sufficientLabeledEvidence ? 'pass' : 'warn',
      blocking:false,
      detail:calibration.sufficientLabeledEvidence
        ? `${calibration.labeledProfiles} labeled profiles support calibration.`
        : `${calibration.labeledProfiles} labeled profiles; more false-positive and confirmed-automation reviews are recommended.`
    },
    {
      id:'high_impact_rate',
      status:impactStable ? 'pass' : 'warn',
      blocking:false,
      detail:evaluations ? `${highImpactRate}% of policy evaluations recommended THROTTLE, DECOY, or QUARANTINE.` : 'No policy evaluation history is available yet.'
    }
  ];

  const blocked = checks.some(c => c.blocking && c.status === 'fail');
  let verdict = 'ready_for_controlled_enforcement_review';
  if (blocked) verdict = 'blocked';
  else if (!enoughObservations || !calibration.sufficientLabeledEvidence || !impactStable) verdict = 'calibrating';

  const nextActions = [];
  if (!identitySafe) nextActions.push('Restore trustworthy proxy-supplied client identity before enabling client-scoped enforcement.');
  if (!proxyProtected) nextActions.push('Route protected site traffic through AnchorWeight before considering enforcement.');
  if (!enoughObservations) nextActions.push(`Collect at least ${RELEASE_READINESS_MIN_POLICY_EVALUATIONS} shadow Policy Engine evaluations.`);
  if (!calibration.sufficientLabeledEvidence) nextActions.push('Review Bot DNA profiles as false positives or confirmed automation to create labeled calibration evidence.');
  if (evaluations && !impactStable) nextActions.push('Use Policy Simulation to reduce an unexpectedly high intervention rate before enforcement.');
  if (verdict === 'ready_for_controlled_enforcement_review') nextActions.push('Run the full test/release gate, review simulation deltas, then consider a limited operator-controlled enforcement trial.');

  return {
    version:1,
    advisoryOnly:true,
    enforcementChanged:false,
    verdict,
    enforcementReady:verdict === 'ready_for_controlled_enforcement_review',
    trackedProfiles:Math.max(calibration.sampledProfiles, Math.round(n(totalProfiles ?? calibration.sampledProfiles))),
    policyEvaluations:evaluations,
    highImpactRecommendations,
    highImpactRate,
    checks,
    calibration,
    nextActions:nextActions.slice(0,8),
    externalReleaseGateRequired:true
  };
}

export function releaseReadinessDescriptor() {
  return {
    version:1,
    available:true,
    authenticated:true,
    advisoryOnly:true,
    mutatesState:false,
    enforcement:false,
    maxProfiles:RELEASE_READINESS_MAX_PROFILES,
    minimumPolicyEvaluations:RELEASE_READINESS_MIN_POLICY_EVALUATIONS,
    requiresTrustedClientIdentity:true,
    requiresExternalReleaseGate:true
  };
}
