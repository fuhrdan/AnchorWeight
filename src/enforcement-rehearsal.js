const ACTIONS = Object.freeze(['allow','observe','budget','throttle','decoy','quarantine']);
const ACTIVE = new Set(['throttle','decoy','quarantine']);
const REVIEW_FALSE_POSITIVE = 'false_positive';
const REVIEW_CONFIRMED = 'confirmed_automation';

export const ENFORCEMENT_REHEARSAL_MAX_PROFILES = 500;
export const ENFORCEMENT_REHEARSAL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ENFORCEMENT_REHEARSAL_MIN_EVALUATIONS = 100;
export const ENFORCEMENT_REHEARSAL_MIN_LABELED = 10;

function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, Math.round(result)) : 0;
}

function actionOf(value) {
  const action = String(value || 'allow');
  return ACTIONS.includes(action) ? action : 'allow';
}

function reviewStatus(profile) {
  return String(profile?.review?.status || 'unreviewed').slice(0, 32);
}

function emptyCounts() {
  return {allow:0,observe:0,budget:0,throttle:0,decoy:0,quarantine:0};
}

function addCounts(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  for (const action of ACTIONS) target[action] += n(source[action]);
}

function safeBotId(value) {
  const id = String(value || '').toUpperCase();
  return /^AW-[A-Z0-9_-]{8}$/.test(id) ? id : null;
}

function currentAction(profile) {
  return actionOf(profile?.policyDecision?.action || profile?.policyForensics?.currentAction);
}

/**
 * Beta.7 Enforcement Rehearsal.
 *
 * This analyzer consumes only bounded public profile projections. It never receives
 * raw IPs, request headers, paths, cookies, credentials, origin URLs, or mutable
 * store objects. It is advisory-only and cannot change policy or enforcement.
 */
export function buildEnforcementRehearsal(publicProfiles = [], {
  now = Date.now(),
  totalProfiles = null,
  windowMs = ENFORCEMENT_REHEARSAL_WINDOW_MS
} = {}) {
  const sample = (Array.isArray(publicProfiles) ? publicProfiles.filter(Boolean) : [])
    .slice(0, ENFORCEMENT_REHEARSAL_MAX_PROFILES);
  const at = Number(now) || Date.now();
  const boundedWindow = Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, n(windowMs) || ENFORCEMENT_REHEARSAL_WINDOW_MS));
  const cutoff = at - boundedWindow;

  const actionCounts = emptyCounts();
  const currentActions = emptyCounts();
  const recentDecisionTransitions = emptyCounts();
  let evaluations = 0;
  let highImpactRecommendations = 0;
  let profilesWithForensics = 0;
  let recentTransitions = 0;

  const falsePositiveConflicts = [];
  const confirmedAutomationAllowed = [];
  let labeledProfiles = 0;
  let falsePositiveLabels = 0;
  let confirmedAutomationLabels = 0;

  for (const profile of sample) {
    const forensics = profile?.policyForensics && typeof profile.policyForensics === 'object'
      ? profile.policyForensics : {};
    const current = currentAction(profile);
    currentActions[current]++;

    const profileEvaluations = n(forensics.evaluations);
    evaluations += profileEvaluations;
    highImpactRecommendations += n(forensics.highImpactRecommendations);
    if (profileEvaluations > 0) profilesWithForensics++;
    addCounts(actionCounts, forensics.actionCounts);

    for (const entry of Array.isArray(forensics.recent) ? forensics.recent.slice(-12) : []) {
      const entryAt = n(entry?.at);
      if (!entryAt || entryAt < cutoff || entryAt > at + 60_000) continue;
      const action = actionOf(entry?.action);
      recentDecisionTransitions[action]++;
      recentTransitions++;
    }

    const review = reviewStatus(profile);
    if (review === REVIEW_FALSE_POSITIVE) {
      labeledProfiles++;
      falsePositiveLabels++;
      if (ACTIVE.has(current)) {
        const id = safeBotId(profile?.id);
        falsePositiveConflicts.push({
          ...(id ? {id} : {}),
          action:current,
          policyRisk:Math.min(100,n(profile?.trafficScores?.policyRisk?.score)),
          resourcePressure:Math.min(100,n(profile?.trafficScores?.resourcePressure?.score))
        });
      }
    } else if (review === REVIEW_CONFIRMED) {
      labeledProfiles++;
      confirmedAutomationLabels++;
      if (current === 'allow') {
        const id = safeBotId(profile?.id);
        confirmedAutomationAllowed.push({
          ...(id ? {id} : {}),
          action:current,
          automationConfidence:Math.min(100,n(profile?.trafficScores?.automationConfidence?.score))
        });
      }
    }
  }

  const highImpactRate = evaluations ? Math.round((highImpactRecommendations / evaluations) * 100) : 0;
  const falsePositiveConflictRate = falsePositiveLabels
    ? Math.round((falsePositiveConflicts.length / falsePositiveLabels) * 100) : 0;
  const enoughEvaluations = evaluations >= ENFORCEMENT_REHEARSAL_MIN_EVALUATIONS;
  const enoughLabels = labeledProfiles >= ENFORCEMENT_REHEARSAL_MIN_LABELED;
  const impactStable = evaluations > 0 && highImpactRate <= 25;

  let verdict = 'clear_for_controlled_trial_review';
  if (falsePositiveConflicts.length > 0) verdict = 'review_required';
  else if (!enoughEvaluations || !enoughLabels || !impactStable) verdict = 'collecting';

  const nextActions = [];
  if (!enoughEvaluations) nextActions.push(`Collect at least ${ENFORCEMENT_REHEARSAL_MIN_EVALUATIONS} shadow Policy Engine evaluations.`);
  if (!enoughLabels) nextActions.push(`Label at least ${ENFORCEMENT_REHEARSAL_MIN_LABELED} profiles across false-positive and confirmed-automation reviews.`);
  if (falsePositiveConflicts.length) nextActions.push('Review every false-positive profile currently receiving THROTTLE, DECOY, or QUARANTINE before any enforcement trial.');
  if (evaluations && !impactStable) nextActions.push('Use Policy Simulation to reduce the high-impact recommendation rate before a controlled trial.');
  if (confirmedAutomationAllowed.length) nextActions.push('Review confirmed automation profiles currently receiving ALLOW; automation alone is not abuse, so this is informational rather than an enforcement error.');
  if (verdict === 'clear_for_controlled_trial_review') nextActions.push('Run release gates, confirm trusted client identity separately, and review a limited operator-controlled trial plan.');

  return {
    version:1,
    advisoryOnly:true,
    shadowRehearsal:true,
    mutatesState:false,
    enforcementChanged:false,
    enforcement:false,
    verdict,
    controlledTrialCandidate:verdict === 'clear_for_controlled_trial_review',
    externalReleaseGateRequired:true,
    trustedClientIdentityGateSeparate:true,
    sampledProfiles:sample.length,
    trackedProfiles:Math.max(sample.length,n(totalProfiles ?? sample.length)),
    profilesWithForensics,
    evaluations,
    highImpactRecommendations,
    highImpactRate,
    actionCounts,
    currentActions,
    recentWindow:{
      milliseconds:boundedWindow,
      hours:Math.round((boundedWindow / 3_600_000) * 10) / 10,
      decisionTransitions:recentTransitions,
      actionCounts:recentDecisionTransitions
    },
    analystComparison:{
      labeledProfiles,
      falsePositiveLabels,
      confirmedAutomationLabels,
      falsePositiveHighImpactConflicts:falsePositiveConflicts.length,
      falsePositiveConflictRate,
      confirmedAutomationCurrentlyAllowed:confirmedAutomationAllowed.length,
      conflicts:falsePositiveConflicts.slice(0,25),
      confirmedAutomationAllowed:confirmedAutomationAllowed.slice(0,25),
      note:'Confirmed automation is not automatically abusive; ALLOW observations are informational unless other risk evidence exists.'
    },
    minimumEvidence:{
      evaluations:ENFORCEMENT_REHEARSAL_MIN_EVALUATIONS,
      labeledProfiles:ENFORCEMENT_REHEARSAL_MIN_LABELED,
      maximumRecommendedHighImpactRate:25
    },
    nextActions:nextActions.slice(0,8),
    privacy:{
      rawIpExposed:false,
      rawHeadersExposed:false,
      rawPathExposed:false,
      rawCookieExposed:false,
      credentialsExposed:false,
      originExposed:false
    }
  };
}

export function enforcementRehearsalDescriptor() {
  return {
    version:1,
    available:true,
    authenticated:true,
    advisoryOnly:true,
    shadowRehearsal:true,
    mutatesState:false,
    enforcement:false,
    maxProfiles:ENFORCEMENT_REHEARSAL_MAX_PROFILES,
    recentWindowHours:24,
    requiresExternalReleaseGate:true,
    requiresTrustedClientIdentityForTrial:true
  };
}
