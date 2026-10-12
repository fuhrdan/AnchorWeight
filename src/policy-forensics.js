const ACTIONS = Object.freeze(['allow','observe','budget','throttle','decoy','quarantine']);
const ACTIVE = new Set(['throttle','decoy','quarantine']);
const MAX_RECENT = 12;
const MAX_REASONS = 16;

function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, Math.round(result)) : 0;
}

function boundedScore(value) {
  return Math.min(100, n(value));
}

function actionOf(decision) {
  const value = String(decision?.action || 'allow');
  return ACTIONS.includes(value) ? value : 'allow';
}

function reasonCodesOf(decision) {
  const retVal = [];
  for (const entry of Array.isArray(decision?.reasons) ? decision.reasons : []) {
    const code = String(entry?.code || '').replace(/[^a-z0-9_:-]/gi,'').slice(0,64);
    if (code && !retVal.includes(code)) retVal.push(code);
    if (retVal.length >= 8) break;
  }
  return retVal.length ? retVal : ['unknown'];
}

function safeCounts(value, allowed = null, limit = MAX_REASONS) {
  const retVal = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return retVal;
  for (const [key, raw] of Object.entries(value)) {
    const safeKey = String(key).replace(/[^a-z0-9_:-]/gi,'').slice(0,64);
    if (!safeKey || (allowed && !allowed.includes(safeKey))) continue;
    retVal[safeKey] = n(raw);
    if (Object.keys(retVal).length >= limit) break;
  }
  return retVal;
}

function safeEntry(entry) {
  const action = actionOf(entry);
  const reasonCodes = Array.isArray(entry?.reasonCodes)
    ? entry.reasonCodes.map(x=>String(x).replace(/[^a-z0-9_:-]/gi,'').slice(0,64)).filter(Boolean).slice(0,8)
    : ['unknown'];
  const inputs = entry?.inputs && typeof entry.inputs === 'object' ? entry.inputs : {};
  return {
    at: n(entry?.at) || null,
    action,
    reasonCodes: reasonCodes.length ? reasonCodes : ['unknown'],
    wouldEnforce: !!entry?.wouldEnforce,
    enforcementEligible: !!entry?.enforcementEligible,
    inputs: {
      automationConfidence: boundedScore(inputs.automationConfidence),
      policyRisk: boundedScore(inputs.policyRisk),
      resourcePressure: boundedScore(inputs.resourcePressure),
      resourceBudgetStatus: ['disabled','within_budget','approaching','exceeded'].includes(String(inputs.resourceBudgetStatus))
        ? String(inputs.resourceBudgetStatus) : 'disabled'
    }
  };
}

export function emptyPolicyForensics() {
  return {
    version: 1,
    evaluations: 0,
    transitions: 0,
    highImpactRecommendations: 0,
    lastAt: null,
    currentAction: 'allow',
    currentReasonCodes: [],
    actionCounts: {allow:0,observe:0,budget:0,throttle:0,decoy:0,quarantine:0},
    reasonCounts: {},
    recent: []
  };
}

/**
 * Beta.3 Policy Forensics + Calibration.
 * Stores only bounded decision metadata. It never receives or persists raw IPs,
 * user agents, paths, queries, cookies, headers, credentials, or origins.
 */
export function recordPolicyForensics(profile = {}, decision = {}, {now = Date.now()} = {}) {
  const prior = profile.policyForensics && typeof profile.policyForensics === 'object'
    ? profile.policyForensics : emptyPolicyForensics();
  const action = actionOf(decision);
  const reasonCodes = reasonCodesOf(decision);
  const previousAction = ACTIONS.includes(prior.currentAction) ? prior.currentAction : 'allow';
  const previousReasons = Array.isArray(prior.currentReasonCodes) ? prior.currentReasonCodes.slice(0,8) : [];
  const evaluations = n(prior.evaluations) + 1;
  const changed = evaluations > 1 && (previousAction !== action || previousReasons.join('|') !== reasonCodes.join('|'));
  const actionCounts = {...emptyPolicyForensics().actionCounts, ...safeCounts(prior.actionCounts, ACTIONS, ACTIONS.length)};
  actionCounts[action] = n(actionCounts[action]) + 1;
  const reasonCounts = safeCounts(prior.reasonCounts);
  for (const code of reasonCodes) reasonCounts[code] = n(reasonCounts[code]) + 1;

  const inputs = decision?.inputs && typeof decision.inputs === 'object' ? decision.inputs : {};
  const entry = safeEntry({
    at: Number(now) || Date.now(),
    action,
    reasonCodes,
    wouldEnforce: !!decision?.wouldEnforce,
    enforcementEligible: !!decision?.enforcementEligible,
    inputs
  });
  const signature = `${entry.action}|${entry.reasonCodes.join('|')}|${entry.wouldEnforce?'1':'0'}|${entry.enforcementEligible?'1':'0'}`;
  const recent = Array.isArray(prior.recent) ? prior.recent.map(safeEntry).slice(-MAX_RECENT) : [];
  const last = recent.at(-1);
  const lastSignature = last ? `${last.action}|${last.reasonCodes.join('|')}|${last.wouldEnforce?'1':'0'}|${last.enforcementEligible?'1':'0'}` : '';
  if (!last || signature !== lastSignature) recent.push(entry);
  while (recent.length > MAX_RECENT) recent.shift();

  profile.policyForensics = {
    version: 1,
    evaluations,
    transitions: n(prior.transitions) + (changed ? 1 : 0),
    highImpactRecommendations: n(prior.highImpactRecommendations) + (ACTIVE.has(action) ? 1 : 0),
    lastAt: entry.at,
    currentAction: action,
    currentReasonCodes: reasonCodes,
    actionCounts,
    reasonCounts,
    recent
  };
  return profile.policyForensics;
}

export function publicPolicyForensics(profile = {}) {
  const value = profile?.policyForensics && typeof profile.policyForensics === 'object'
    ? profile.policyForensics : emptyPolicyForensics();
  const actionCounts = {...emptyPolicyForensics().actionCounts, ...safeCounts(value.actionCounts, ACTIONS, ACTIONS.length)};
  return {
    version: 1,
    evaluations: n(value.evaluations),
    transitions: n(value.transitions),
    highImpactRecommendations: n(value.highImpactRecommendations),
    lastAt: n(value.lastAt) || null,
    currentAction: ACTIONS.includes(value.currentAction) ? value.currentAction : 'allow',
    currentReasonCodes: Array.isArray(value.currentReasonCodes)
      ? value.currentReasonCodes.map(x=>String(x).replace(/[^a-z0-9_:-]/gi,'').slice(0,64)).filter(Boolean).slice(0,8) : [],
    actionCounts,
    reasonCounts: safeCounts(value.reasonCounts),
    recent: Array.isArray(value.recent) ? value.recent.slice(-MAX_RECENT).map(safeEntry) : []
  };
}
