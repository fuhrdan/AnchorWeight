function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function boundedInt(value, fallback, min, max) {
  const result = Math.round(Number(value));
  if (!Number.isFinite(result)) return fallback;
  return Math.max(min, Math.min(max, result));
}

function currentBucket(profile) {
  const buckets = Array.isArray(profile?.agentBehavior?.minuteBuckets)
    ? profile.agentBehavior.minuteBuckets
    : [];
  return buckets.length ? buckets[buckets.length - 1] : null;
}

function routeBreadth5m(profile) {
  const buckets = Array.isArray(profile?.agentBehavior?.minuteBuckets)
    ? profile.agentBehavior.minuteBuckets.slice(-5)
    : [];
  const routes = new Set();
  for (const bucket of buckets) {
    for (const routeHash of Array.isArray(bucket?.routeHashes) ? bucket.routeHashes : []) {
      routes.add(String(routeHash));
      if (routes.size >= 320) return 320;
    }
  }
  return routes.size;
}

function configLimits(config = {}) {
  return {
    requestsPerMinute: boundedInt(config.resourceBudgetRequestsPerMinute, 120, 1, 100000),
    uniqueUrlsPerMinute: boundedInt(config.resourceBudgetUniqueUrlsPerMinute, 60, 1, 64),
    routeBreadth5m: boundedInt(config.resourceBudgetRouteBreadth5m, 120, 1, 320),
    retriesPerMinute: boundedInt(config.resourceBudgetRetriesPerMinute, 20, 1, 10000),
    resourcePressure: boundedInt(config.resourceBudgetPressureScore, 70, 1, 100)
  };
}

function observed(profile, trafficScores = {}) {
  const bucket = currentBucket(profile);
  return {
    requestsPerMinute: n(bucket?.requests),
    uniqueUrlsPerMinute: Array.isArray(bucket?.routeHashes) ? bucket.routeHashes.length : 0,
    routeBreadth5m: routeBreadth5m(profile),
    retriesPerMinute: n(bucket?.retries),
    resourcePressure: Math.min(100, n(trafficScores?.resourcePressure?.score))
  };
}

function utilizationPercent(value, limit) {
  if (!limit) return 0;
  return Math.min(999, Math.round((value / limit) * 100));
}

export function emptyResourceBudget() {
  return {
    version: 1,
    enabled: false,
    enforcement: 'shadow_only',
    status: 'disabled',
    evaluatedAt: null,
    approachPercent: 80,
    limits: null,
    observed: null,
    utilization: {},
    approaching: [],
    exceeded: [],
    wouldAction: 'allow'
  };
}

/**
 * Beta.1 resource budget evaluator. It is descriptive only: no score,
 * quarantine, throttle, deception, gateway or proxy mutation occurs here.
 */
export function evaluateResourceBudget(profile, trafficScores = {}, config = {}, { now = Date.now() } = {}) {
  if (!config.resourceBudgetsEnabled) return emptyResourceBudget();

  const limits = configLimits(config);
  const values = observed(profile, trafficScores);
  const approachPercent = boundedInt(config.resourceBudgetApproachPercent, 80, 50, 99);
  const utilization = {};
  const approaching = [];
  const exceeded = [];

  for (const key of Object.keys(limits)) {
    const pct = utilizationPercent(values[key], limits[key]);
    utilization[key] = pct;
    if (pct >= 100) exceeded.push(key);
    else if (pct >= approachPercent) approaching.push(key);
  }

  const status = exceeded.length ? 'exceeded' : (approaching.length ? 'approaching' : 'within_budget');
  return {
    version: 1,
    enabled: true,
    enforcement: 'shadow_only',
    status,
    evaluatedAt: Number(now) || null,
    approachPercent,
    limits,
    observed: values,
    utilization,
    approaching: approaching.slice(0, 8),
    exceeded: exceeded.slice(0, 8),
    wouldAction: status === 'exceeded' ? 'budget_exceeded' : (status === 'approaching' ? 'observe_closely' : 'allow')
  };
}

export function publicResourceBudget(profile) {
  const budget = profile?.resourceBudget;
  if (!budget || typeof budget !== 'object') return emptyResourceBudget();
  return {
    version: 1,
    enabled: !!budget.enabled,
    enforcement: 'shadow_only',
    status: ['disabled','within_budget','approaching','exceeded'].includes(budget.status) ? budget.status : 'disabled',
    evaluatedAt: Number(budget.evaluatedAt) || null,
    approachPercent: boundedInt(budget.approachPercent, 80, 50, 99),
    limits: budget.limits && typeof budget.limits === 'object' ? { ...budget.limits } : null,
    observed: budget.observed && typeof budget.observed === 'object' ? { ...budget.observed } : null,
    utilization: budget.utilization && typeof budget.utilization === 'object' ? { ...budget.utilization } : {},
    approaching: Array.isArray(budget.approaching) ? budget.approaching.slice(0,8).map(String) : [],
    exceeded: Array.isArray(budget.exceeded) ? budget.exceeded.slice(0,8).map(String) : [],
    wouldAction: String(budget.wouldAction || 'allow').slice(0,32)
  };
}
