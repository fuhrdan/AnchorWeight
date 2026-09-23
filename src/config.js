import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}
function intEnv(name, fallback, min, max) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function listEnv(name) {
  return String(process.env[name] || '').split(',').map(x => x.trim()).filter(Boolean);
}


function ratePathEnv() {
  const raw=process.env.AW_GATEWAY_RATE_PATHS || '[]';
  try {return JSON.parse(raw);} catch {return raw;} // Schema rejects invalid configuration at startup.
}

function profileEnv() {
  const name = String(process.env.AW_PROFILE || '').trim();
  if (!name) return {};
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('AW_PROFILE contains invalid characters');
  const file = path.resolve(process.cwd(), 'config', 'profiles', `${name}.json`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const schemaVersion = parsed.schemaVersion ?? 1;
  if (schemaVersion !== 1) throw new Error(`Unsupported configuration profile schema version ${schemaVersion}`);
  const out = {};
  for (const [k,v] of Object.entries(parsed.env || parsed)) out[k] = String(v);
  return { name, env: out, file, schemaVersion };
}

export function loadConfig(overrides = {}) {
  const prof = profileEnv();
  for (const [k,v] of Object.entries(prof.env || {})) if (process.env[k] == null) process.env[k]=v;
  const basePath = (process.env.AW_BASE_PATH || '/anchor').replace(/\/$/, '') || '/anchor';
  const blackholePath = (process.env.AW_BLACKHOLE_PATH || `${basePath}/blackhole`).replace(/\/+$/, '') || `${basePath}/blackhole`;
  return {
    port: intEnv('PORT', 8080, 1, 65535),
    secret: process.env.AW_SECRET || crypto.randomBytes(32).toString('hex'),
    basePath,
    blackholeEnabled: boolEnv('AW_BLACKHOLE_ENABLED', true),
    blackholePath,
    blackholeInjectLink: boolEnv('AW_BLACKHOLE_INJECT_LINK', true),
    blackholeMaxResponseBytes: intEnv('AW_BLACKHOLE_MAX_RESPONSE_BYTES', 2097152, 16384, 16777216),
    shadowMode: boolEnv('AW_SHADOW_MODE', true),
    blockDepth: intEnv('AW_BLOCK_DEPTH', 3, 2, 8),
    blockMinutes: intEnv('AW_BLOCK_MINUTES', 60, 1, 10080),
    repeatBlockMinutes: intEnv('AW_REPEAT_BLOCK_MINUTES', 1440, 1, 43200),
    quarantineMode: process.env.AW_QUARANTINE_MODE || 'decoy',
    sessionTtlMinutes: intEnv('AW_SESSION_TTL_MINUTES', 30, 1, 1440),
    sessionBindIp: boolEnv('AW_SESSION_BIND_IP', true),
    trustProxy: boolEnv('AW_TRUST_PROXY', false),
    trustedJa4Enabled: boolEnv('AW_TRUSTED_JA4_ENABLED', false),
    intelligenceEnabled: boolEnv('AW_INTELLIGENCE_ENABLED', false),
    intelligenceSiteId: process.env.AW_INTELLIGENCE_SITE_ID || '',
    intelligenceSiteSecret: process.env.AW_INTELLIGENCE_SITE_SECRET || '',
    intelligenceHubUrl: process.env.AW_INTELLIGENCE_HUB_URL || '',
    dashboardEnabled: boolEnv('AW_DASHBOARD_ENABLED', true),
    dashboardToken: process.env.AW_DASHBOARD_TOKEN || '',
    logFile: process.env.AW_LOG_FILE || './data/anchorweight-events.jsonl',
    stateFile: process.env.AW_STATE_FILE || './data/anchorweight-state.json',
    stateBackend: (process.env.AW_STATE_BACKEND || 'json').toLowerCase(),
    sqliteFile: process.env.AW_SQLITE_FILE || './data/anchorweight-state.sqlite',
    // Browser edits require explicit operator opt-in; environment remains the baseline.
    setupConfigEnabled: boolEnv('AW_SETUP_CONFIG_ENABLED', false),
    setupWritesEnabled: boolEnv('AW_SETUP_WRITES_ENABLED', false),
    setupAllowedOrigins: listEnv('AW_SETUP_ALLOWED_ORIGINS'),
    setupPublicHost: process.env.AW_SETUP_PUBLIC_HOST || '',
    setupBaselineOrigin: process.env.AW_ORIGIN_URL || 'http://127.0.0.1:8081',
    declarativeEnabled: boolEnv('AW_DECLARATIVE_ENABLED', false),
    declarativeWritesEnabled: boolEnv('AW_DECLARATIVE_WRITES_ENABLED', false),
    declarativeFile: process.env.AW_DECLARATIVE_FILE || './data/anchorweight-gateway.json',
    routesEnabled: boolEnv('AW_ROUTES_ENABLED', false),
    routesFile: process.env.AW_ROUTES_FILE || './data/anchorweight-routes.json',
    routeAllowedOrigins: listEnv('AW_ROUTE_ALLOWED_ORIGINS'),
    // Opt-in protection for proxied applications. Credentials never belong in environment logs.
    appAuthEnabled: boolEnv('AW_APP_AUTH_ENABLED', false),
    appAuthFile: process.env.AW_APP_AUTH_FILE || './data/anchorweight-app-auth.json',
    proxyEnabled: boolEnv('AW_PROXY_ENABLED', false),
    originUrl: process.env.AW_ORIGIN_URL || 'http://127.0.0.1:8081',
    proxyTimeoutMs: intEnv('AW_PROXY_TIMEOUT_MS', 15000, 1000, 120000),
    gatewayAccessEnabled: boolEnv('AW_GATEWAY_ACCESS_ENABLED', false),
    gatewayRateEnabled: boolEnv('AW_GATEWAY_RATE_ENABLED', false),
    gatewayShadowMode: boolEnv('AW_GATEWAY_SHADOW_MODE', true),
    gatewayAllowIps: listEnv('AW_GATEWAY_ALLOW_IPS'),
    gatewayDenyIps: listEnv('AW_GATEWAY_DENY_IPS'),
    gatewayRatePerMinute: intEnv('AW_GATEWAY_RATE_PER_MINUTE', 120, 1, 100000),
    gatewayRatePaths: ratePathEnv(),
    gatewayHealthEnabled: boolEnv('AW_GATEWAY_HEALTH_ENABLED', false),
    gatewayHealthIntervalMs: intEnv('AW_GATEWAY_HEALTH_INTERVAL_MS', 30000, 5000, 300000),
    gatewayHealthTimeoutMs: intEnv('AW_GATEWAY_HEALTH_TIMEOUT_MS', 2000, 500, 10000),
    gatewayMaintenanceEnabled: boolEnv('AW_GATEWAY_MAINTENANCE_ENABLED', false),
    gatewayMaintenanceTitle: process.env.AW_GATEWAY_MAINTENANCE_TITLE || 'Service temporarily unavailable',
    gatewayMaintenanceMessage: process.env.AW_GATEWAY_MAINTENANCE_MESSAGE || 'Please try again shortly.',
    publicScheme: process.env.AW_PUBLIC_SCHEME || 'https',
    branchCount: intEnv('AW_CANARY_BRANCH_COUNT', 7, 2, 12),
    canaryVariantsEnabled: boolEnv('AW_CANARY_VARIANTS_ENABLED', true),
    scoreEnforcementEnabled: boolEnv('AW_SCORE_ENFORCEMENT_ENABLED', false),
    quarantineScore: intEnv('AW_QUARANTINE_SCORE', 100, 1, 1000),
    scoreLure: intEnv('AW_SCORE_LURE', 5, 0, 100),
    scoreBlackhole: intEnv('AW_SCORE_BLACKHOLE', 100, 0, 1000),
    scoreTraversal: intEnv('AW_SCORE_TRAVERSAL', 20, 0, 100),
    scoreProofOfCrawl: intEnv('AW_SCORE_PROOF', 40, 0, 200),
    scoreInvalidTraversal: intEnv('AW_SCORE_INVALID', 8, 0, 100),
    scoreMissingUa: intEnv('AW_SCORE_MISSING_UA', 5, 0, 100),
    scoreAutomationUa: intEnv('AW_SCORE_AUTOMATION_UA', 15, 0, 100),
    scoreUaChange: intEnv('AW_SCORE_UA_CHANGE', 10, 0, 100),
    scoreRapidBurst: intEnv('AW_SCORE_RAPID_BURST', 10, 0, 100),
    scoreSpoofedGoodBot: intEnv('AW_SCORE_SPOOFED_GOOD_BOT', 25, 0, 200),
    scoreSharedCanary: intEnv('AW_SCORE_SHARED_CANARY', 20, 0, 200),
    rapidRequestMs: intEnv('AW_RAPID_REQUEST_MS', 250, 10, 10000),
    rapidRequestBurst: intEnv('AW_RAPID_REQUEST_BURST', 6, 2, 100),
    goodBotVerificationEnabled: boolEnv('AW_GOOD_BOT_VERIFICATION_ENABLED', true),
    goodBotCacheMinutes: intEnv('AW_GOOD_BOT_CACHE_MINUTES', 1440, 1, 10080),
    allowBotIds: listEnv('AW_ALLOW_BOT_IDS'),
    quarantineBotIds: listEnv('AW_QUARANTINE_BOT_IDS'),
    profileName: prof.name || null,
    profileFile: prof.file || null,
    profileSchemaVersion: prof.schemaVersion || 1,
    eventRetentionDays: intEnv('AW_EVENT_RETENTION_DAYS', 30, 1, 3650),
    eventMaxMb: intEnv('AW_EVENT_MAX_MB', 50, 1, 4096),
    adminRateLimitPerMinute: intEnv('AW_ADMIN_RATE_LIMIT_PER_MINUTE', 60, 5, 10000),
    csrfTtlMinutes: intEnv('AW_CSRF_TTL_MINUTES', 15, 1, 1440),
    adminBodyMaxBytes: intEnv('AW_ADMIN_BODY_MAX_BYTES', 8192, 512, 1048576),
    proxyBodyMaxBytes: intEnv('AW_PROXY_BODY_MAX_BYTES', 26214400, 1024, 1073741824),
    allowQueryAdminToken: boolEnv('AW_ALLOW_QUERY_ADMIN_TOKEN', false),
    auditEnabled: boolEnv('AW_AUDIT_ENABLED', true),
    auditLogFile: process.env.AW_AUDIT_LOG_FILE || './data/anchorweight-audit.jsonl',
    readinessOriginCheck: boolEnv('AW_READINESS_ORIGIN_CHECK', true),
    shutdownGraceMs: intEnv('AW_SHUTDOWN_GRACE_MS', 10000, 1000, 120000),
    ...overrides
  };
}
