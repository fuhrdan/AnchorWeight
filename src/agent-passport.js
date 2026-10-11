export const AGENT_PASSPORT_PATH = '/.well-known/anchorweight';
export const AGENT_PASSPORT_SCHEMA = 'anchorweight-agent-passport/v1';
export const AGENT_PASSPORT_VERSION = '3.0.0-alpha.5';

const TRAFFIC_CLASSES = [
  'browser_or_unknown',
  'verified_search_crawler',
  'declared_ai_crawler',
  'user_directed_agent',
  'unknown_automation'
];

const DECLARED_PURPOSES = [
  'unknown',
  'model_training',
  'search_indexing',
  'user_retrieval',
  'general_automation'
];

function publicEnforcement(config = {}) {
  return {
    shadowMode: !!config.shadowMode,
    legacyScoreEnforcementEnabled: !!config.scoreEnforcementEnabled,
    trafficDimensionsEnforced: false,
    resourceBudgetsAvailable: false,
    policyEngineAvailable: false
  };
}

/**
 * Public, deterministic capability document. This intentionally excludes
 * origins, credentials, tokens, raw client identifiers and trap secrets.
 */
export function createAgentPassport(config = {}) {
  return {
    schema: AGENT_PASSPORT_SCHEMA,
    service: 'AnchorWeight',
    version: AGENT_PASSPORT_VERSION,
    endpoint: AGENT_PASSPORT_PATH,
    capabilities: {
      agentIdentity: {
        version: 1,
        trafficClasses: [...TRAFFIC_CLASSES],
        declaredPurposes: [...DECLARED_PURPOSES]
      },
      agentBehavior: {
        version: 1,
        observationOnly: true
      },
      trafficScoring: {
        version: 1,
        dimensions: ['automationConfidence', 'policyRisk', 'resourcePressure'],
        enforcement: 'legacy_score_only'
      },
      agentTrafficObservatory: {
        version: 1,
        authenticated: true
      },
      proofOfCrawl: {
        available: true,
        bounded: true
      }
    },
    enforcement: publicEnforcement(config),
    privacy: {
      rawIpExposed: false,
      rawUserAgentExposed: false,
      rawPathExposed: false,
      rawQueryExposed: false,
      rawCookieExposed: false,
      originExposed: false,
      credentialsExposed: false
    },
    discovery: {
      methods: ['GET', 'HEAD'],
      cacheSeconds: 300,
      corsReadable: true
    }
  };
}

function setHeader(res, name, value) {
  if (typeof res?.setHeader === 'function') res.setHeader(name, value);
}

/**
 * Handle the public passport endpoint. Returns true when the request path is
 * owned by the passport handler, false when normal AnchorWeight routing should continue.
 */
export function handleAgentPassport(req, res, url, config = {}) {
  if (url?.pathname !== AGENT_PASSPORT_PATH) return false;

  const method = String(req?.method || 'GET').toUpperCase();
  setHeader(res, 'X-Content-Type-Options', 'nosniff');
  setHeader(res, 'Referrer-Policy', 'no-referrer');
  setHeader(res, 'X-Robots-Tag', 'noindex, nofollow');
  setHeader(res, 'Access-Control-Allow-Origin', '*');

  if (!['GET', 'HEAD'].includes(method)) {
    if (res) res.statusCode = 405;
    setHeader(res, 'Allow', 'GET, HEAD');
    setHeader(res, 'Cache-Control', 'no-store');
    setHeader(res, 'Content-Type', 'application/json; charset=utf-8');
    res?.end?.(JSON.stringify({ error:'method_not_allowed' }));
    return true;
  }

  const body = JSON.stringify(createAgentPassport(config));
  if (res) res.statusCode = 200;
  setHeader(res, 'Cache-Control', 'public, max-age=300');
  setHeader(res, 'Content-Type', 'application/json; charset=utf-8');
  setHeader(res, 'Content-Length', String(Buffer.byteLength(body)));
  res?.end?.(method === 'HEAD' ? '' : body);
  return true;
}
