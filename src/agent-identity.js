/**
 * AnchorWeight 3.0-alpha.1 traffic identity taxonomy.
 *
 * This module is observation-only. A declared User-Agent is evidence of what a
 * client claims to be, not proof of provider ownership and never a risk score.
 */

export const TRAFFIC_CLASSES = Object.freeze({
  BROWSER_OR_UNKNOWN: 'browser_or_unknown',
  VERIFIED_SEARCH_CRAWLER: 'verified_search_crawler',
  DECLARED_AI_CRAWLER: 'declared_ai_crawler',
  USER_DIRECTED_AGENT: 'user_directed_agent',
  UNKNOWN_AUTOMATION: 'unknown_automation'
});

export const AGENT_PURPOSES = Object.freeze({
  UNKNOWN: 'unknown',
  MODEL_TRAINING: 'model_training',
  SEARCH_INDEXING: 'search_indexing',
  USER_RETRIEVAL: 'user_retrieval',
  GENERAL_AUTOMATION: 'general_automation'
});

const DECLARED_RULES = Object.freeze([
  // OpenAI publishes these as separate controls/purposes.
  { token:'chatgpt-user', pattern:/\bChatGPT-User(?:\/[A-Za-z0-9._-]+)?\b/i, provider:'openai', family:'chatgpt-user', trafficClass:TRAFFIC_CLASSES.USER_DIRECTED_AGENT, purpose:AGENT_PURPOSES.USER_RETRIEVAL },
  { token:'oai-searchbot', pattern:/\bOAI-SearchBot(?:\/[A-Za-z0-9._-]+)?\b/i, provider:'openai', family:'oai-searchbot', trafficClass:TRAFFIC_CLASSES.DECLARED_AI_CRAWLER, purpose:AGENT_PURPOSES.SEARCH_INDEXING },
  { token:'gptbot', pattern:/\bGPTBot(?:\/[A-Za-z0-9._-]+)?\b/i, provider:'openai', family:'gptbot', trafficClass:TRAFFIC_CLASSES.DECLARED_AI_CRAWLER, purpose:AGENT_PURPOSES.MODEL_TRAINING },

  // Anthropic likewise publishes separate training/search/user-directed bots.
  { token:'claude-user', pattern:/\bClaude-User(?:\/[A-Za-z0-9._-]+)?\b/i, provider:'anthropic', family:'claude-user', trafficClass:TRAFFIC_CLASSES.USER_DIRECTED_AGENT, purpose:AGENT_PURPOSES.USER_RETRIEVAL },
  { token:'claude-searchbot', pattern:/\bClaude-SearchBot(?:\/[A-Za-z0-9._-]+)?\b/i, provider:'anthropic', family:'claude-searchbot', trafficClass:TRAFFIC_CLASSES.DECLARED_AI_CRAWLER, purpose:AGENT_PURPOSES.SEARCH_INDEXING },
  { token:'claudebot', pattern:/\bClaudeBot(?:\/[A-Za-z0-9._-]+)?\b/i, provider:'anthropic', family:'claudebot', trafficClass:TRAFFIC_CLASSES.DECLARED_AI_CRAWLER, purpose:AGENT_PURPOSES.MODEL_TRAINING }
]);

const GENERIC_AUTOMATION = /bot|crawler|spider|scrape|curl|wget|python-requests|httpclient|go-http-client|headless/i;

function userAgentFrom(req) {
  const value = req?.headers?.['user-agent'];
  if (typeof value === 'string') return value.slice(0, 2048);
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string').join(' ').slice(0, 2048);
  return '';
}

export function observeTrafficIdentity(req) {
  const ua = userAgentFrom(req);

  for (const rule of DECLARED_RULES) {
    if (rule.pattern.test(ua)) {
      return {
        declared: true,
        trafficClass: rule.trafficClass,
        provider: rule.provider,
        family: rule.family,
        purpose: rule.purpose,
        confidence: 'declared',
        source: 'user_agent',
        evidence: [`declared_user_agent:${rule.token}`]
      };
    }
  }

  if (GENERIC_AUTOMATION.test(ua)) {
    return {
      declared: false,
      trafficClass: TRAFFIC_CLASSES.UNKNOWN_AUTOMATION,
      provider: null,
      family: null,
      purpose: AGENT_PURPOSES.GENERAL_AUTOMATION,
      confidence: 'heuristic',
      source: 'user_agent',
      evidence: ['generic_automation_user_agent']
    };
  }

  return {
    declared: false,
    trafficClass: TRAFFIC_CLASSES.BROWSER_OR_UNKNOWN,
    provider: null,
    family: null,
    purpose: AGENT_PURPOSES.UNKNOWN,
    confidence: 'none',
    source: null,
    evidence: []
  };
}

function compactObservation(observation) {
  return {
    declared: !!observation?.declared,
    trafficClass: Object.values(TRAFFIC_CLASSES).includes(observation?.trafficClass)
      ? observation.trafficClass : TRAFFIC_CLASSES.BROWSER_OR_UNKNOWN,
    provider: typeof observation?.provider === 'string' ? observation.provider : null,
    family: typeof observation?.family === 'string' ? observation.family : null,
    purpose: Object.values(AGENT_PURPOSES).includes(observation?.purpose)
      ? observation.purpose : AGENT_PURPOSES.UNKNOWN,
    confidence: ['none','heuristic','declared','verified'].includes(observation?.confidence)
      ? observation.confidence : 'none',
    source: observation?.source === 'user_agent' ? 'user_agent' : null,
    evidence: Array.isArray(observation?.evidence)
      ? observation.evidence.map(String).filter(v => /^[a-z0-9_:-]{1,80}$/i.test(v)).slice(0, 4) : []
  };
}

export function recordTrafficIdentity(profile, observation, now = Date.now()) {
  profile.agentIdentity ||= { observations:0, lastAt:null, current:null, history:[] };
  profile.agentIdentity.history ||= [];
  const current = compactObservation(observation);
  const prior = profile.agentIdentity.current;
  const changed = !prior || prior.trafficClass !== current.trafficClass ||
    prior.provider !== current.provider || prior.family !== current.family ||
    prior.purpose !== current.purpose || prior.confidence !== current.confidence;

  profile.agentIdentity.observations = (profile.agentIdentity.observations || 0) + 1;
  profile.agentIdentity.lastAt = now;
  profile.agentIdentity.current = current;

  if (changed) {
    profile.agentIdentity.history.push({ at:now, ...current });
    if (profile.agentIdentity.history.length > 8) profile.agentIdentity.history.shift();
  }

  return { changed, current };
}

export function publicTrafficIdentity(profile) {
  if (profile?.goodBotVerified) {
    return {
      declared: !!profile.goodBotClaimed,
      trafficClass: TRAFFIC_CLASSES.VERIFIED_SEARCH_CRAWLER,
      provider: profile.goodBotProvider || 'verified_search',
      family: null,
      purpose: AGENT_PURPOSES.SEARCH_INDEXING,
      confidence: 'verified',
      source: 'verified_good_bot',
      evidence: ['verified_search_crawler'],
      observations: profile.agentIdentity?.observations || 0,
      lastAt: profile.agentIdentity?.lastAt || null,
      history: (profile.agentIdentity?.history || []).slice(-8)
    };
  }

  const current = compactObservation(profile?.agentIdentity?.current || {});
  return {
    ...current,
    observations: profile?.agentIdentity?.observations || 0,
    lastAt: profile?.agentIdentity?.lastAt || null,
    history: (profile?.agentIdentity?.history || []).slice(-8).map(entry => ({
      at: Number(entry?.at) || null,
      ...compactObservation(entry)
    }))
  };
}
