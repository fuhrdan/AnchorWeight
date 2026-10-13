import { observeTrafficIdentity, AGENT_PURPOSES } from './agent-identity.js';

export const AI_AGENT_ACTIONS = Object.freeze({
  ALLOW: 'allow',
  OBSERVE: 'observe',
  DENY: 'deny'
});

export const AI_AGENT_PROVIDERS = Object.freeze(['openai','anthropic','google','perplexity']);

export const AI_AGENT_ROBOTS = Object.freeze([
  { provider:'openai', family:'gptbot', robotsToken:'GPTBot', purpose:AGENT_PURPOSES.MODEL_TRAINING },
  { provider:'openai', family:'oai-searchbot', robotsToken:'OAI-SearchBot', purpose:AGENT_PURPOSES.SEARCH_INDEXING },
  { provider:'openai', family:'oai-adsbot', robotsToken:'OAI-AdsBot', purpose:AGENT_PURPOSES.GENERAL_AUTOMATION },
  { provider:'anthropic', family:'claudebot', robotsToken:'ClaudeBot', purpose:AGENT_PURPOSES.MODEL_TRAINING },
  { provider:'anthropic', family:'claude-searchbot', robotsToken:'Claude-SearchBot', purpose:AGENT_PURPOSES.SEARCH_INDEXING },
  { provider:'anthropic', family:'claude-user', robotsToken:'Claude-User', purpose:AGENT_PURPOSES.USER_RETRIEVAL },
  { provider:'perplexity', family:'perplexitybot', robotsToken:'PerplexityBot', purpose:AGENT_PURPOSES.SEARCH_INDEXING },
  { provider:'perplexity', family:'perplexity-user', robotsToken:'Perplexity-User', purpose:AGENT_PURPOSES.USER_RETRIEVAL },
  { provider:'google', family:'google-cloudvertexbot', robotsToken:'Google-CloudVertexBot', purpose:AGENT_PURPOSES.GENERAL_AUTOMATION },
  // Google-Extended is a robots product token, not an HTTP User-Agent.
  { provider:'google', family:'google-extended', robotsToken:'Google-Extended', purpose:AGENT_PURPOSES.MODEL_TRAINING, robotsOnly:true }
]);

const VALID_ACTIONS = new Set(Object.values(AI_AGENT_ACTIONS));
const RULE_RE = /^([a-z0-9_-]{2,32}):([a-z0-9_-]{2,64})=(allow|observe|deny)$/;

function normalizeAction(value, fallback = AI_AGENT_ACTIONS.OBSERVE) {
  const action=String(value || '').trim().toLowerCase();
  return VALID_ACTIONS.has(action) ? action : fallback;
}

export function parseAiAgentFamilyRules(input = []) {
  const source=Array.isArray(input) ? input : String(input || '').split(',');
  const rules=new Map();
  const invalid=[];
  for(const raw of source.slice(0,32)) {
    const value=String(raw || '').trim().toLowerCase();
    if(!value) continue;
    const match=value.match(RULE_RE);
    if(!match) { invalid.push(value.slice(0,128)); continue; }
    rules.set(`${match[1]}:${match[2]}`,match[3]);
  }
  return { rules, invalid };
}

function purposeAction(config, purpose) {
  if(purpose===AGENT_PURPOSES.MODEL_TRAINING) return normalizeAction(config.aiAgentTrainingAction);
  if(purpose===AGENT_PURPOSES.SEARCH_INDEXING) return normalizeAction(config.aiAgentSearchAction);
  if(purpose===AGENT_PURPOSES.USER_RETRIEVAL) return normalizeAction(config.aiAgentUserAction);
  return normalizeAction(config.aiAgentAutomationAction);
}

export function resolveAiAgentAction(identity = {}, config = {}) {
  const parsed=parseAiAgentFamilyRules(config.aiAgentFamilyRules || []);
  const key=identity?.provider && identity?.family ? `${identity.provider}:${identity.family}`.toLowerCase() : '';
  if(key && parsed.rules.has(key)) return { action:parsed.rules.get(key), source:'family_override', invalidRules:parsed.invalid };
  return { action:purposeAction(config,identity?.purpose), source:'purpose_default', invalidRules:parsed.invalid };
}

export function evaluateAiAgentRequestPolicy(req, config = {}, { pathname='' } = {}) {
  const identity=observeTrafficIdentity(req);
  const matched=!!identity?.declared && AI_AGENT_PROVIDERS.includes(identity?.provider);
  const enabled=config.aiAgentPolicyEnabled !== false;
  if(!matched) {
    return {
      version:1, enabled, matched:false, action:AI_AGENT_ACTIONS.ALLOW,
      enforcement:'not_applicable', enforcementEligible:false, trustGranted:false,
      provider:null, family:null, purpose:null, reason:'not_declared_supported_ai_agent'
    };
  }

  if(!enabled) {
    return {
      version:1, enabled:false, matched:true, action:AI_AGENT_ACTIONS.ALLOW,
      enforcement:'disabled', enforcementEligible:false, trustGranted:false,
      provider:identity.provider, family:identity.family, purpose:identity.purpose,
      reason:'ai_agent_policy_disabled'
    };
  }

  const resolved=resolveAiAgentAction(identity,config);
  const denyRequested=resolved.action===AI_AGENT_ACTIONS.DENY;
  const shadow=config.aiAgentPolicyShadowMode !== false;
  const explicitEnforcement=!!config.aiAgentPolicyEnforcementEnabled;
  const robotsDiscovery=String(pathname || '')==='/robots.txt';
  const enforcementEligible=denyRequested && explicitEnforcement && !shadow && !robotsDiscovery;
  let enforcement='pass';
  let reason=resolved.source;
  if(denyRequested) {
    enforcement=enforcementEligible?'deny':'shadow_only';
    if(robotsDiscovery) reason='robots_discovery_allowed';
    else if(!explicitEnforcement) reason='enforcement_not_enabled';
    else if(shadow) reason='ai_agent_shadow_mode';
  } else if(resolved.action===AI_AGENT_ACTIONS.OBSERVE) enforcement='observe';
  else enforcement='allow_without_trust';

  return {
    version:1,
    enabled:true,
    matched:true,
    action:resolved.action,
    enforcement,
    enforcementEligible,
    trustGranted:false,
    provider:identity.provider,
    family:identity.family,
    purpose:identity.purpose,
    reason,
    invalidRuleCount:resolved.invalidRules.length
  };
}

export function buildAiAgentRobots(config = {}) {
  if(config.aiAgentPolicyEnabled === false) return '';
  const groups=[];
  for(const entry of AI_AGENT_ROBOTS) {
    const resolved=resolveAiAgentAction(entry,config);
    if(resolved.action!==AI_AGENT_ACTIONS.DENY) continue;
    groups.push(`User-agent: ${entry.robotsToken}\nDisallow: /`);
  }
  return groups.join('\n\n') + (groups.length ? '\n' : '');
}

export function describeAiAgentPolicy(config = {}) {
  const parsed=parseAiAgentFamilyRules(config.aiAgentFamilyRules || []);
  return {
    version:1,
    enabled:config.aiAgentPolicyEnabled !== false,
    shadowMode:config.aiAgentPolicyShadowMode !== false,
    enforcementEnabled:!!config.aiAgentPolicyEnforcementEnabled,
    actions:[...VALID_ACTIONS],
    providers:[...AI_AGENT_PROVIDERS],
    defaults:{
      modelTraining:normalizeAction(config.aiAgentTrainingAction),
      searchIndexing:normalizeAction(config.aiAgentSearchAction),
      userRetrieval:normalizeAction(config.aiAgentUserAction),
      generalAutomation:normalizeAction(config.aiAgentAutomationAction)
    },
    familyOverrideCount:parsed.rules.size,
    invalidFamilyRuleCount:parsed.invalid.length,
    allowGrantsTrust:false,
    denyRequiresTrustedClientIdentity:false,
    rawUserAgentRetained:false,
    robotsGuidanceAvailable:true
  };
}
