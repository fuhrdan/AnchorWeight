import { evaluatePolicyDecision, POLICY_ACTION_LADDER } from './policy-engine.js';

export const POLICY_SIMULATION_MAX_PROFILES = 500;
export const POLICY_SIMULATION_MAX_CHANGES = 25;

const ACTIVE = new Set(['throttle','decoy','quarantine']);
const SCENARIO_KEYS = Object.freeze([
  'observeAutomation',
  'throttlePressure',
  'decoyRisk',
  'quarantineRisk'
]);

function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function threshold(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 100)
    throw new Error(`invalid_policy_simulation_${name}`);
  return result;
}

function configured(config, key, fallback) {
  const value = Math.round(Number(config?.[key]));
  return Number.isFinite(value) ? Math.max(1, Math.min(100, value)) : fallback;
}

function safeAction(value) {
  const action = String(value || 'allow');
  return POLICY_ACTION_LADDER.includes(action) ? action : 'allow';
}

function score(profile, key) {
  return Math.max(0, Math.min(100, Math.round(n(profile?.trafficScores?.[key]?.score))));
}

function simulationProfile(profile) {
  return {
    manualPolicy: profile?.manualPolicy || null,
    goodBotVerified: !!profile?.goodBot?.verified,
    agentIdentity: profile?.agentIdentity && typeof profile.agentIdentity === 'object'
      ? profile.agentIdentity : { trafficClass:'browser_or_unknown' },
    proofOfCrawl: Math.round(n(profile?.proofOfCrawl)),
    blackholeVisits: Math.round(n(profile?.blackholeVisits)),
    invalidTraversals: Math.round(n(profile?.invalidTraversals))
  };
}

function actionCounts() {
  return { allow:0, observe:0, budget:0, throttle:0, decoy:0, quarantine:0 };
}

function reasonCodes(decision) {
  return (Array.isArray(decision?.reasons) ? decision.reasons : [])
    .map(item => String(item?.code || '').replace(/[^a-z0-9_:-]/gi,'').slice(0,64))
    .filter(Boolean)
    .slice(0,8);
}

export function normalizePolicyScenario(input = {}, config = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('invalid_policy_simulation_document');
  for (const key of Object.keys(input)) {
    if (!SCENARIO_KEYS.includes(key)) throw new Error('unknown_policy_simulation_field');
  }

  const retVal = {
    observeAutomation: threshold(input.observeAutomation, configured(config,'policyObserveAutomation',65), 'observe_automation'),
    throttlePressure: threshold(input.throttlePressure, configured(config,'policyThrottlePressure',70), 'throttle_pressure'),
    decoyRisk: threshold(input.decoyRisk, configured(config,'policyDecoyRisk',65), 'decoy_risk'),
    quarantineRisk: threshold(input.quarantineRisk, configured(config,'policyQuarantineRisk',85), 'quarantine_risk')
  };
  if (retVal.decoyRisk > retVal.quarantineRisk)
    throw new Error('invalid_policy_simulation_risk_order');
  return retVal;
}

export function policySimulationDescriptor(config = {}) {
  return {
    version: 1,
    available: true,
    authenticated: true,
    readOnly: true,
    mutatesState: false,
    enforcement: false,
    maxProfiles: POLICY_SIMULATION_MAX_PROFILES,
    maxChangedProfiles: POLICY_SIMULATION_MAX_CHANGES,
    current: normalizePolicyScenario({}, config)
  };
}

/**
 * Beta.4 Policy Simulation / What-If Analysis.
 *
 * Input profiles must already be public Bot DNA projections. Candidate policy
 * evaluation is forced into shadow/no-enforcement posture and never writes to
 * the supplied profile objects, store, block state, configuration, or logs.
 */
export function simulatePolicyScenario(publicProfiles = [], input = {}, config = {}, options = {}) {
  const scenario = normalizePolicyScenario(input, config);
  const baseline = normalizePolicyScenario({}, config);
  const all = Array.isArray(publicProfiles) ? publicProfiles.filter(Boolean) : [];
  const sample = all.slice(0, POLICY_SIMULATION_MAX_PROFILES);
  const totalProfiles = Math.max(sample.length, Math.round(n(options.totalProfiles ?? all.length)));
  const currentActions = actionCounts();
  const simulatedActions = actionCounts();
  const changes = [];
  let escalations = 0;
  let deescalations = 0;
  let currentHighImpact = 0;
  let simulatedHighImpact = 0;

  const candidateConfig = {
    ...config,
    policyEngineEnabled: true,
    policyEngineEnforcementEnabled: false,
    policyEngineShadowMode: true,
    shadowMode: true,
    policyObserveAutomation: scenario.observeAutomation,
    policyThrottlePressure: scenario.throttlePressure,
    policyDecoyRisk: scenario.decoyRisk,
    policyQuarantineRisk: scenario.quarantineRisk
  };

  for (const profile of sample) {
    const currentAction = safeAction(profile?.policyDecision?.action);
    const simulated = evaluatePolicyDecision(
      simulationProfile(profile),
      profile?.trafficScores || {},
      profile?.resourceBudget || {},
      candidateConfig,
      { now: Number(options.now) || 1 }
    );
    const simulatedAction = safeAction(simulated.action);
    currentActions[currentAction]++;
    simulatedActions[simulatedAction]++;
    if (ACTIVE.has(currentAction)) currentHighImpact++;
    if (ACTIVE.has(simulatedAction)) simulatedHighImpact++;

    const currentRank = POLICY_ACTION_LADDER.indexOf(currentAction);
    const simulatedRank = POLICY_ACTION_LADDER.indexOf(simulatedAction);
    if (simulatedRank > currentRank) escalations++;
    else if (simulatedRank < currentRank) deescalations++;

    if (simulatedAction !== currentAction && changes.length < POLICY_SIMULATION_MAX_CHANGES) {
      changes.push({
        id: String(profile?.id || '').slice(0,32),
        currentAction,
        simulatedAction,
        rankDelta: simulatedRank - currentRank,
        reasonCodes: reasonCodes(simulated),
        automationConfidence: score(profile,'automationConfidence'),
        policyRisk: score(profile,'policyRisk'),
        resourcePressure: score(profile,'resourcePressure'),
        resourceBudgetStatus: ['disabled','within_budget','approaching','exceeded'].includes(String(profile?.resourceBudget?.status))
          ? String(profile.resourceBudget.status) : 'disabled'
      });
    }
  }

  const changedProfiles = escalations + deescalations;
  return {
    version: 1,
    enforcement: 'simulation_only',
    readOnly: true,
    stateMutation: false,
    baseline,
    scenario,
    sampledProfiles: sample.length,
    totalProfiles,
    truncated: totalProfiles > sample.length,
    changedProfiles,
    unchangedProfiles: Math.max(0, sample.length - changedProfiles),
    escalations,
    deescalations,
    currentHighImpact,
    simulatedHighImpact,
    currentActions,
    simulatedActions,
    changes
  };
}
