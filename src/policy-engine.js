export const POLICY_ACTIONS = Object.freeze({
  ALLOW: 'allow',
  OBSERVE: 'observe',
  BUDGET: 'budget',
  THROTTLE: 'throttle',
  DECOY: 'decoy',
  QUARANTINE: 'quarantine'
});

export const POLICY_ACTION_LADDER = Object.freeze([
  POLICY_ACTIONS.ALLOW,
  POLICY_ACTIONS.OBSERVE,
  POLICY_ACTIONS.BUDGET,
  POLICY_ACTIONS.THROTTLE,
  POLICY_ACTIONS.DECOY,
  POLICY_ACTIONS.QUARANTINE
]);

function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function bounded(value, fallback, min, max) {
  const result = Math.round(Number(value));
  if (!Number.isFinite(result)) return fallback;
  return Math.max(min, Math.min(max, result));
}

function score(scores, key) {
  return Math.min(100, bounded(scores?.[key]?.score, 0, 0, 100));
}

function trafficClass(profile) {
  if (profile?.goodBotVerified) return 'verified_search_crawler';
  return profile?.agentIdentity?.current?.trafficClass || profile?.agentIdentity?.trafficClass || 'browser_or_unknown';
}

function enforcementPosture(config = {}) {
  const enabled = config.policyEngineEnabled !== false;
  const policyShadow = config.policyEngineShadowMode !== false;
  const globalShadow = config.shadowMode !== false;
  const enforcementEnabled = !!config.policyEngineEnforcementEnabled;
  const enforce = enabled && enforcementEnabled && !policyShadow && !globalShadow;
  return {
    enabled,
    policyShadowMode: policyShadow,
    globalShadowMode: globalShadow,
    enforcementEnabled,
    enforce
  };
}

function reason(code, detail = undefined) {
  return detail === undefined ? { code } : { code, detail };
}

export function emptyPolicyDecision() {
  return {
    version: 1,
    enabled: false,
    action: POLICY_ACTIONS.ALLOW,
    actionRank: 0,
    enforcement: 'disabled',
    enforcementEligible: false,
    wouldEnforce: false,
    evaluatedAt: null,
    reasons: [{ code:'policy_engine_disabled' }],
    inputs: {
      trafficClass:'browser_or_unknown',
      automationConfidence:0,
      policyRisk:0,
      resourcePressure:0,
      resourceBudgetStatus:'disabled',
      manualPolicy:null,
      verifiedSearchCrawler:false,
      proofOfCrawl:0,
      blackholeVisits:0,
      invalidTraversals:0
    }
  };
}

/**
 * Beta.2 Policy Engine. The evaluator is pure: it never mutates the profile,
 * score, budget, block store, response, gateway, proxy, or intervention state.
 * Execution is separately gated by explicit operator configuration.
 */
export function evaluatePolicyDecision(profile = {}, trafficScores = {}, resourceBudget = {}, config = {}, { now = Date.now() } = {}) {
  const posture = enforcementPosture(config);
  if (!posture.enabled) return emptyPolicyDecision();

  const automation = score(trafficScores, 'automationConfidence');
  const policyRisk = score(trafficScores, 'policyRisk');
  const pressure = score(trafficScores, 'resourcePressure');
  const budgetStatus = ['disabled','within_budget','approaching','exceeded'].includes(resourceBudget?.status)
    ? resourceBudget.status : 'disabled';
  const manualPolicy = profile?.manualPolicy || null;
  const verified = !!profile?.goodBotVerified;
  const cls = trafficClass(profile);
  const proof = n(profile?.proofOfCrawl);
  const blackhole = n(profile?.blackholeVisits);
  const invalid = n(profile?.invalidTraversals);

  const observeAutomation = bounded(config.policyObserveAutomation, 65, 1, 100);
  const throttlePressure = bounded(config.policyThrottlePressure, 70, 1, 100);
  const decoyRisk = bounded(config.policyDecoyRisk, 65, 1, 100);
  const quarantineRisk = bounded(config.policyQuarantineRisk, 85, 1, 100);

  let action = POLICY_ACTIONS.ALLOW;
  const reasons = [];

  if (manualPolicy === 'allow') {
    action = POLICY_ACTIONS.ALLOW;
    reasons.push(reason('manual_allow'));
  } else if (manualPolicy === 'quarantine') {
    action = POLICY_ACTIONS.QUARANTINE;
    reasons.push(reason('manual_quarantine'));
  } else if (verified) {
    action = POLICY_ACTIONS.ALLOW;
    reasons.push(reason('verified_search_crawler'));
  } else if (policyRisk >= quarantineRisk && (blackhole > 0 || invalid >= 2 || (proof > 0 && policyRisk >= 95))) {
    action = POLICY_ACTIONS.QUARANTINE;
    reasons.push(reason('corroborated_policy_risk', { policyRisk, blackholeVisits:blackhole, invalidTraversals:invalid, proofOfCrawl:proof }));
  } else if (policyRisk >= decoyRisk) {
    action = POLICY_ACTIONS.DECOY;
    reasons.push(reason('high_policy_risk', { policyRisk }));
  } else if (budgetStatus === 'exceeded' && (pressure >= throttlePressure || automation >= observeAutomation)) {
    action = POLICY_ACTIONS.THROTTLE;
    reasons.push(reason('resource_budget_exceeded', { resourcePressure:pressure, automationConfidence:automation }));
  } else if (pressure >= throttlePressure && automation >= observeAutomation) {
    action = POLICY_ACTIONS.THROTTLE;
    reasons.push(reason('automated_resource_pressure', { resourcePressure:pressure, automationConfidence:automation }));
  } else if (budgetStatus === 'approaching' || budgetStatus === 'exceeded') {
    action = POLICY_ACTIONS.BUDGET;
    reasons.push(reason(budgetStatus === 'exceeded' ? 'budget_exceeded_without_enforcement_threshold' : 'budget_approaching'));
  } else if (automation >= observeAutomation || policyRisk >= 15 || pressure >= 40) {
    action = POLICY_ACTIONS.OBSERVE;
    if (automation >= observeAutomation) reasons.push(reason('automation_observed', { automationConfidence:automation }));
    if (policyRisk >= 15) reasons.push(reason('policy_risk_observed', { policyRisk }));
    if (pressure >= 40) reasons.push(reason('resource_pressure_observed', { resourcePressure:pressure }));
  } else {
    reasons.push(reason('no_policy_intervention_needed'));
  }

  const actionRank = Math.max(0, POLICY_ACTION_LADDER.indexOf(action));
  const activeAction = [POLICY_ACTIONS.THROTTLE, POLICY_ACTIONS.DECOY, POLICY_ACTIONS.QUARANTINE].includes(action);
  const enforcementEligible = posture.enforce && activeAction;
  const enforcement = !posture.enforcementEnabled || posture.policyShadowMode || posture.globalShadowMode
    ? 'shadow_only' : 'eligible';

  return {
    version: 1,
    enabled: true,
    action,
    actionRank,
    enforcement,
    enforcementEligible,
    wouldEnforce: activeAction,
    evaluatedAt: Number(now) || null,
    reasons: reasons.slice(0,8),
    inputs: {
      trafficClass: cls,
      automationConfidence: automation,
      policyRisk,
      resourcePressure: pressure,
      resourceBudgetStatus: budgetStatus,
      manualPolicy,
      verifiedSearchCrawler: verified,
      proofOfCrawl: proof,
      blackholeVisits: blackhole,
      invalidTraversals: invalid
    }
  };
}

export function publicPolicyDecision(profile) {
  const p = profile?.policyDecision;
  if (!p || typeof p !== 'object') return emptyPolicyDecision();
  const action = POLICY_ACTION_LADDER.includes(p.action) ? p.action : POLICY_ACTIONS.ALLOW;
  return {
    version:1,
    enabled:!!p.enabled,
    action,
    actionRank:Math.max(0,POLICY_ACTION_LADDER.indexOf(action)),
    enforcement:['disabled','shadow_only','eligible'].includes(p.enforcement) ? p.enforcement : 'shadow_only',
    enforcementEligible:!!p.enforcementEligible,
    wouldEnforce:!!p.wouldEnforce,
    evaluatedAt:Number(p.evaluatedAt)||null,
    reasons:Array.isArray(p.reasons) ? p.reasons.slice(0,8).map(x=>({code:String(x?.code||'unknown').slice(0,64),...(x?.detail===undefined?{}:{detail:x.detail})})) : [],
    inputs:p.inputs && typeof p.inputs==='object' ? {
      trafficClass:String(p.inputs.trafficClass||'browser_or_unknown').slice(0,64),
      automationConfidence:Math.min(100,n(p.inputs.automationConfidence)),
      policyRisk:Math.min(100,n(p.inputs.policyRisk)),
      resourcePressure:Math.min(100,n(p.inputs.resourcePressure)),
      resourceBudgetStatus:String(p.inputs.resourceBudgetStatus||'disabled').slice(0,32),
      manualPolicy:p.inputs.manualPolicy || null,
      verifiedSearchCrawler:!!p.inputs.verifiedSearchCrawler,
      proofOfCrawl:n(p.inputs.proofOfCrawl),
      blackholeVisits:n(p.inputs.blackholeVisits),
      invalidTraversals:n(p.inputs.invalidTraversals)
    } : emptyPolicyDecision().inputs
  };
}
