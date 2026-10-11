function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function level(score) {
  if (score >= 85) return 'very_high';
  if (score >= 65) return 'high';
  if (score >= 40) return 'moderate';
  if (score >= 15) return 'low';
  return 'minimal';
}

function scoreOf(profile, key) {
  return Math.max(0, Math.min(100, Math.round(n(profile?.trafficScores?.[key]?.score))));
}

function trafficClass(profile) {
  return profile?.agentIdentity?.trafficClass || profile?.agentIdentity?.current?.trafficClass || 'browser_or_unknown';
}

function budgetStatus(profile) {
  const status=String(profile?.resourceBudget?.status || 'disabled');
  return ['disabled','within_budget','approaching','exceeded'].includes(status) ? status : 'disabled';
}

function maxBudgetUtilization(profile) {
  const values=Object.values(profile?.resourceBudget?.utilization || {}).map(n);
  return values.length ? Math.max(...values) : 0;
}

function policyAction(profile) {
  const action=String(profile?.policyDecision?.action || 'allow');
  return ['allow','observe','budget','throttle','decoy','quarantine'].includes(action) ? action : 'allow';
}

function policyWouldEnforce(profile) {
  return !!profile?.policyDecision?.wouldEnforce;
}

function policyEnforcementEligible(profile) {
  return !!profile?.policyDecision?.enforcementEligible;
}

function purpose(profile) {
  return profile?.agentIdentity?.purpose || profile?.agentIdentity?.current?.purpose || 'unknown';
}

function bump(target, key) {
  const safe = String(key || 'unknown').slice(0, 64);
  target[safe] = (target[safe] || 0) + 1;
}

function bandCounts(profiles, key) {
  const retVal = { minimal:0, low:0, moderate:0, high:0, very_high:0 };
  for (const profile of profiles) retVal[level(scoreOf(profile,key))]++;
  return retVal;
}

function compact(profile) {
  return {
    id: String(profile?.id || '').slice(0, 32),
    trafficClass: trafficClass(profile),
    purpose: purpose(profile),
    automationConfidence: scoreOf(profile,'automationConfidence'),
    policyRisk: scoreOf(profile,'policyRisk'),
    resourcePressure: scoreOf(profile,'resourcePressure'),
    legacyScore: Math.max(0, Math.round(n(profile?.score))),
    requestCount: Math.max(0, Math.round(n(profile?.requestCount)))
    ,budgetStatus: budgetStatus(profile),
    maxBudgetUtilization: maxBudgetUtilization(profile)
    ,policyAction: policyAction(profile),
    policyWouldEnforce: policyWouldEnforce(profile),
    policyEnforcementEligible: policyEnforcementEligible(profile)
  };
}

function topBy(profiles, key, limit = 5) {
  return [...profiles]
    .sort((a,b) => scoreOf(b,key) - scoreOf(a,key) || n(b?.requestCount) - n(a?.requestCount))
    .slice(0,Math.max(1,Math.min(10,limit)))
    .map(compact);
}

/**
 * Alpha.4 Agent Traffic Observatory.
 * Input must already be public-profile projections; no raw client keys, paths,
 * cookies, UAs, IPs or request headers are accepted or returned here.
 */
export function buildAgentTrafficObservatory(publicProfiles = []) {
  const profiles = Array.isArray(publicProfiles) ? publicProfiles.filter(Boolean) : [];
  const classes = {};
  const purposes = {};
  let automatedProfiles = 0;
  let policyConcernProfiles = 0;
  let highPressureProfiles = 0;
  let automationTotal = 0;
  let policyTotal = 0;
  let pressureTotal = 0;
  let budgetEnabledProfiles = 0;
  let budgetWithinProfiles = 0;
  let budgetApproachingProfiles = 0;
  let budgetExceededProfiles = 0;
  const policyActions = {allow:0,observe:0,budget:0,throttle:0,decoy:0,quarantine:0};
  let policyWouldEnforceProfiles = 0;
  let policyEnforcementEligibleProfiles = 0;

  for (const profile of profiles) {
    bump(classes, trafficClass(profile));
    bump(purposes, purpose(profile));
    const automation = scoreOf(profile,'automationConfidence');
    const policy = scoreOf(profile,'policyRisk');
    const pressure = scoreOf(profile,'resourcePressure');
    automationTotal += automation;
    policyTotal += policy;
    pressureTotal += pressure;
    if (automation >= 65) automatedProfiles++;
    if (policy >= 40) policyConcernProfiles++;
    if (pressure >= 65) highPressureProfiles++;
    const budget=budgetStatus(profile);
    if (budget !== 'disabled') budgetEnabledProfiles++;
    if (budget === 'within_budget') budgetWithinProfiles++;
    else if (budget === 'approaching') budgetApproachingProfiles++;
    else if (budget === 'exceeded') budgetExceededProfiles++;
    policyActions[policyAction(profile)]++;
    if (policyWouldEnforce(profile)) policyWouldEnforceProfiles++;
    if (policyEnforcementEligible(profile)) policyEnforcementEligibleProfiles++;
  }

  const count = profiles.length;
  return {
    version:1,
    enforcement:'observation_only',
    trackedProfiles:count,
    automatedProfiles,
    policyConcernProfiles,
    highPressureProfiles,
    resourceBudgets:{
      enforcement:'shadow_only',
      enabledProfiles:budgetEnabledProfiles,
      withinBudgetProfiles:budgetWithinProfiles,
      approachingProfiles:budgetApproachingProfiles,
      exceededProfiles:budgetExceededProfiles
    },
    policyEngine:{
      enforcement:'shadow_first',
      actions:policyActions,
      wouldEnforceProfiles:policyWouldEnforceProfiles,
      enforcementEligibleProfiles:policyEnforcementEligibleProfiles
    },
    trafficClasses:classes,
    purposes,
    averages:{
      automationConfidence:count ? Math.round(automationTotal / count) : 0,
      policyRisk:count ? Math.round(policyTotal / count) : 0,
      resourcePressure:count ? Math.round(pressureTotal / count) : 0
    },
    bands:{
      automationConfidence:bandCounts(profiles,'automationConfidence'),
      policyRisk:bandCounts(profiles,'policyRisk'),
      resourcePressure:bandCounts(profiles,'resourcePressure')
    },
    topAutomation:topBy(profiles,'automationConfidence'),
    topPolicyRisk:topBy(profiles,'policyRisk'),
    topResourcePressure:topBy(profiles,'resourcePressure')
  };
}
