import path from 'node:path';
import { parseRules, parseRatePaths } from './gateway-policy.js';
export const CONFIG_SCHEMA_VERSION = 1;

export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  const oneOf = (name, value, allowed) => {
    if (!allowed.includes(value)) errors.push(`${name} must be one of: ${allowed.join(', ')}`);
  };
  const intRange = (name, value, min, max) => {
    if (!Number.isInteger(value) || value < min || value > max) errors.push(`${name} must be an integer between ${min} and ${max}`);
  };

  if (!/^\/[A-Za-z0-9/_-]*$/.test(config.basePath || '')) errors.push('basePath must be an absolute URL path containing only letters, digits, /, _, or -');
  if (config.blackholeEnabled) {
    if (!/^\/[A-Za-z0-9/_-]*$/.test(config.blackholePath || '')) errors.push('blackholePath must be an absolute URL path containing only letters, digits, /, _, or -');
    if (config.blackholePath === config.basePath || !String(config.blackholePath || '').startsWith(`${config.basePath}/`)) errors.push('blackholePath must be below basePath');
    intRange('blackholeMaxResponseBytes', config.blackholeMaxResponseBytes, 16384, 16777216);
    intRange('scoreBlackhole', config.scoreBlackhole, 0, 1000);
  }
  intRange('port', config.port, 1, 65535);
  intRange('blockDepth', config.blockDepth, 2, 8);
  intRange('branchCount', config.branchCount ?? 7, 2, 12);
  if (config.canaryVariantsEnabled != null && typeof config.canaryVariantsEnabled !== 'boolean') errors.push('canaryVariantsEnabled must be boolean');
  intRange('blockMinutes', config.blockMinutes, 1, 10080);
  intRange('repeatBlockMinutes', config.repeatBlockMinutes, 1, 43200);
  intRange('proxyTimeoutMs', config.proxyTimeoutMs, 1000, 120000);
  intRange('eventRetentionDays', config.eventRetentionDays, 1, 3650);
  intRange('eventMaxMb', config.eventMaxMb, 1, 4096);
  intRange('adminRateLimitPerMinute', config.adminRateLimitPerMinute, 5, 10000);
  intRange('csrfTtlMinutes', config.csrfTtlMinutes, 1, 1440);
  intRange('adminBodyMaxBytes', config.adminBodyMaxBytes, 512, 1048576);
  intRange('proxyBodyMaxBytes', config.proxyBodyMaxBytes, 1024, 1073741824);
  intRange('shutdownGraceMs', config.shutdownGraceMs, 1000, 120000);
  intRange('gatewayRatePerMinute',config.gatewayRatePerMinute??120,1,100000);
  // Circuit breakers must not silently turn on because of a route or proxy setting.
  for (const name of ['resilienceEnabled','resilienceHealthEnabled'])
    if (config[name] !== undefined && typeof config[name] !== 'boolean') errors.push(`${name} must be boolean`);
  intRange('resilienceFailureThreshold',config.resilienceFailureThreshold??3,2,20);
  intRange('resilienceCooldownMs',config.resilienceCooldownMs??30000,1000,300000);
  intRange('resilienceHealthIntervalMs',config.resilienceHealthIntervalMs??30000,5000,300000);
  intRange('resilienceHealthTimeoutMs',config.resilienceHealthTimeoutMs??2000,500,10000);
  if (config.resilienceHealthEnabled && !config.resilienceEnabled) errors.push('resilienceHealthEnabled requires resilienceEnabled');
  if ((config.resilienceAllowedOrigins||[]).length>32) errors.push('too many resilience allowed origins');
  intRange('gatewayHealthIntervalMs',config.gatewayHealthIntervalMs??30000,5000,300000);
  intRange('gatewayHealthTimeoutMs',config.gatewayHealthTimeoutMs??2000,500,10000);
  for(const name of ['gatewayAccessEnabled','gatewayRateEnabled','gatewayShadowMode','gatewayHealthEnabled','gatewayMaintenanceEnabled'])
    if(config[name]!==undefined && typeof config[name]!=='boolean')errors.push(`${name} must be boolean`);
  try {
    if((config.gatewayAllowIps||[]).length>128||(config.gatewayDenyIps||[]).length>128)throw Error('too_many_ip_rules');
    parseRules(config.gatewayAllowIps||[]);parseRules(config.gatewayDenyIps||[]);
  } catch {errors.push('gateway IP rules require valid IPv4/IPv6 addresses or CIDR ranges (max 128 each)');}
  try {parseRatePaths(JSON.stringify(config.gatewayRatePaths??[]));}
  catch {errors.push('gateway rate paths must be up to 16 valid {path,perMinute} entries');}
  if(config.gatewayAccessEnabled||config.gatewayRateEnabled)warnings.push('Gateway rules apply only to proxied traffic; use gateway shadow mode to validate before enforcement.');
  for(const [key,max] of [['gatewayMaintenanceTitle',80],['gatewayMaintenanceMessage',160]]) {
    const value=config[key];
    if(value!=null && (typeof value!=='string'||value.length<1||value.length>max||/[\x00-\x1f\x7f]/.test(value)))errors.push(`${key} must be printable text up to ${max} characters`);
  }
  if(config.gatewayMaintenanceEnabled)warnings.push('Maintenance fallback masks transport errors for GET/HEAD only; not origin HTTP 5xx or partial responses.');
  oneOf('stateBackend', config.stateBackend ?? 'json', ['json','sqlite']);
  if (config.stateBackend === 'sqlite' && !config.sqliteFile) errors.push('sqliteFile is required for the SQLite backend');
  if (config.stateBackend === 'sqlite' && config.sqliteFile && config.stateFile && path.resolve(config.sqliteFile) === path.resolve(config.stateFile)) errors.push('sqliteFile and stateFile must be different files');
  oneOf('quarantineMode', config.quarantineMode, ['decoy','429']);
  oneOf('publicScheme', config.publicScheme, ['http','https']);

  if (typeof config.secret !== 'string' || config.secret.length < 16) warnings.push('AW_SECRET should be a persistent secret of at least 16 characters; 32+ random bytes recommended.');
  if (config.dashboardEnabled && !config.dashboardToken) warnings.push('Dashboard is enabled but AW_DASHBOARD_TOKEN is empty; authenticated API requests will be rejected.');
  if (config.dashboardToken && config.dashboardToken.length < 16) warnings.push('AW_DASHBOARD_TOKEN should be at least 16 characters; 32+ random bytes recommended.');

  if (config.declarativeEnabled && (config.routesEnabled || config.setupConfigEnabled))
    errors.push('AW_DECLARATIVE_ENABLED cannot be combined with legacy AW_ROUTES_ENABLED or AW_SETUP_CONFIG_ENABLED; migrate intentionally');
  if (config.declarativeWritesEnabled && !config.declarativeEnabled) errors.push('AW_DECLARATIVE_WRITES_ENABLED requires AW_DECLARATIVE_ENABLED');
  if (config.declarativeWritesEnabled && !config.dashboardToken) errors.push('Declarative writes require AW_DASHBOARD_TOKEN');
  if (config.declarativeEnabled) warnings.push('Declarative file controls proxy origin and routes; enforcement, auth, and secrets remain in cPanel.');
  if (config.routesEnabled != null && typeof config.routesEnabled !== 'boolean') errors.push('routesEnabled must be boolean');
  if (config.routesEnabled && (!config.routesFile || !config.setupPublicHost)) errors.push('routesEnabled requires routesFile and setupPublicHost');
  if ((config.routeAllowedOrigins||[]).length > 32) errors.push('routeAllowedOrigins must contain no more than 32 entries');
  if (config.routesEnabled) warnings.push('Multi-origin routes are restart-only, explicitly approved and apply to proxy traffic only.');

  if (config.appAuthEnabled) {
    if (config.publicScheme !== 'https') errors.push('application authentication requires AW_PUBLIC_SCHEME=https and TLS at the public edge');
    if (!config.appAuthFile || typeof config.appAuthFile !== 'string') errors.push('appAuthFile is required when application authentication is enabled');
    warnings.push('Application authentication protects proxied routes only. Disable direct access to protected origins.');
  }
  if (config.proxyEnabled) {
    try {
      const u = new URL(config.originUrl);
      if (!['http:','https:'].includes(u.protocol)) errors.push('originUrl must use http:// or https://');
      if (u.username || u.password) errors.push('originUrl must not contain credentials');
      if (u.search || u.hash) errors.push('originUrl must not contain a query string or fragment');
    } catch {
      errors.push('originUrl is not a valid URL');
    }
  }

  if (config.intelligenceEnabled) {
    if (!/^[a-z][a-z0-9_-]{2,31}$/.test(config.intelligenceSiteId || '')) errors.push('intelligenceSiteId must be 3-32 lowercase letters, digits, _ or - starting with a letter');
    if (typeof config.intelligenceSiteSecret !== 'string' || config.intelligenceSiteSecret.length < 32) errors.push('intelligenceSiteSecret must be at least 32 characters');
    try {
      const hub = new URL(config.intelligenceHubUrl);
      if (hub.username || hub.password || hub.hash || hub.search || hub.pathname !== '/v1/evidence' ||
          !(hub.protocol === 'https:' || (hub.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(hub.hostname)))) {
        errors.push('intelligenceHubUrl must be HTTPS /v1/evidence (HTTP allowed only on loopback) without credentials or query');
      }
    } catch {errors.push('intelligenceHubUrl is invalid');}
    warnings.push('Distributed intelligence is opt-in; only locally verified bounded evidence is forwarded.');
  }
  if (config.alertsEnabled) {
    if (!config.alertsFile || typeof config.alertsFile !== 'string') errors.push('AW_ALERTS_FILE is required');
    if (!Array.isArray(config.alertAllowedHosts) || config.alertAllowedHosts.length < 1 || config.alertAllowedHosts.length > 8) errors.push('AW_ALERT_ALLOWED_HOSTS requires 1-8 hosts');
    if (typeof config.alertSigningKey !== 'string' || config.alertSigningKey.length < 32) errors.push('AW_ALERT_SIGNING_KEY requires 32+ characters');
    warnings.push('Alerts are best-effort, process-local and restricted to approved HTTPS destinations.');
  }
  if (config.observatoryLiveEnabled != null && typeof config.observatoryLiveEnabled !== 'boolean') errors.push('observatoryLiveEnabled must be boolean');
  if (config.setupWritesEnabled && !config.setupConfigEnabled) errors.push('setupWritesEnabled requires setupConfigEnabled');
  if (config.setupWritesEnabled && !config.dashboardToken) errors.push('setupWritesEnabled requires an authenticated dashboard token');
  if (config.setupConfigEnabled) warnings.push('Operator configuration file may override only proxyEnabled and originUrl; disable AW_SETUP_CONFIG_ENABLED to ignore it.');
  if (config.trustProxy) warnings.push('trustProxy is enabled; only use it behind a trusted proxy that overwrites X-Forwarded-For.');
  if (config.trustedJa4Enabled && !config.trustProxy) errors.push('trustedJa4Enabled requires trustProxy');
  if (config.trustedJa4Enabled) warnings.push('trustedJa4Enabled requires the trusted TLS terminator to OVERWRITE X-AW-JA4 and strip client-supplied values.');
  if (config.allowQueryAdminToken) warnings.push('allowQueryAdminToken is enabled; bearer-only admin authentication is recommended.');
  if (config.scoreEnforcementEnabled) warnings.push('score-based enforcement is enabled; review Shadow Mode evidence before enabling in production.');
  for (const name of [
    'canaryEnabled',
    'canaryShadowMode',
    'canaryFileTrapsEnabled',
    'canaryRouteTrapsEnabled',
    'canaryTokenTrapsEnabled',
    'canaryCookieEnabled'
  ])
    if (config[name] != null && typeof config[name] !== 'boolean')
      errors.push(`${name} must be boolean`);

  intRange('canaryTokenTtlSeconds',config.canaryTokenTtlSeconds??3600,60,86400);
  intRange('canaryCookieThreshold',config.canaryCookieThreshold??85,1,100);
  intRange('canaryCookieTtlSeconds',config.canaryCookieTtlSeconds??1800,60,86400);

  if (config.canaryCookieName &&
      !/^__Host-[A-Za-z0-9_-]{1,80}$/.test(config.canaryCookieName))
    errors.push('canaryCookieName must use a __Host- prefixed safe cookie name');

  if (config.canaryEnabled && !config.canaryShadowMode)
    warnings.push('Canary Intelligence shadow mode is disabled; verify Proof-of-Intent evidence before changing policy enforcement.');

  if (config.canaryCookieEnabled)
    warnings.push('Suspect-only Canary Intelligence cookie issuance is enabled.');

  if (config.resourceBudgetsEnabled != null && typeof config.resourceBudgetsEnabled !== 'boolean') errors.push('resourceBudgetsEnabled must be boolean');
  intRange('resourceBudgetRequestsPerMinute',config.resourceBudgetRequestsPerMinute??120,1,100000);
  intRange('resourceBudgetUniqueUrlsPerMinute',config.resourceBudgetUniqueUrlsPerMinute??60,1,64);
  intRange('resourceBudgetRouteBreadth5m',config.resourceBudgetRouteBreadth5m??120,1,320);
  intRange('resourceBudgetRetriesPerMinute',config.resourceBudgetRetriesPerMinute??20,1,10000);
  intRange('resourceBudgetPressureScore',config.resourceBudgetPressureScore??70,1,100);
  intRange('resourceBudgetApproachPercent',config.resourceBudgetApproachPercent??80,50,99);
  if (config.resourceBudgetsEnabled) warnings.push('Resource Budgets are enabled in beta.1 shadow-only mode; exceeded budgets do not enforce policy.');
  for (const name of ['policyEngineEnabled','policyEngineShadowMode','policyEngineEnforcementEnabled'])
    if (config[name] != null && typeof config[name] !== 'boolean') errors.push(`${name} must be boolean`);
  intRange('policyObserveAutomation',config.policyObserveAutomation??65,1,100);
  intRange('policyThrottlePressure',config.policyThrottlePressure??70,1,100);
  intRange('policyDecoyRisk',config.policyDecoyRisk??65,1,100);
  intRange('policyQuarantineRisk',config.policyQuarantineRisk??85,1,100);
  intRange('policyThrottleSeconds',config.policyThrottleSeconds??30,1,3600);
  intRange('policyQuarantineMinutes',config.policyQuarantineMinutes??60,1,10080);
  if (config.policyEngineEnforcementEnabled && !config.policyEngineEnabled) errors.push('policyEngineEnforcementEnabled requires policyEngineEnabled');
  if (config.policyEngineEnabled) warnings.push('Policy Engine beta.2 is shadow-first; recommendations are evaluated independently from legacy Bot DNA score.');
  if (config.policyEngineEnforcementEnabled && (config.policyEngineShadowMode || config.shadowMode)) warnings.push('Policy Engine enforcement is enabled but a shadow mode is still active, so policy actions remain non-enforcing.');
  if (config.policyEngineEnforcementEnabled && !config.policyEngineShadowMode && !config.shadowMode) warnings.push('Policy Engine enforcement is ACTIVE for bounded throttle, decoy, and quarantine actions; verify production identity safety first.');
  for (const name of ['aiAgentPolicyEnabled','aiAgentPolicyShadowMode','aiAgentPolicyEnforcementEnabled'])
    if (config[name] != null && typeof config[name] !== 'boolean') errors.push(`${name} must be boolean`);
  for (const name of ['aiAgentTrainingAction','aiAgentSearchAction','aiAgentUserAction','aiAgentAutomationAction'])
    oneOf(name, config[name] ?? 'observe', ['allow','observe','deny']);
  const aiAgentFamilyRules = config.aiAgentFamilyRules ?? [];
  if (!Array.isArray(aiAgentFamilyRules)) errors.push('aiAgentFamilyRules must be an array');
  else {
    if (aiAgentFamilyRules.length > 32) errors.push('aiAgentFamilyRules must contain no more than 32 entries');
    for (const rule of aiAgentFamilyRules) if (!/^[a-z0-9_-]{2,32}:[a-z0-9_-]{2,64}=(?:allow|observe|deny)$/.test(String(rule||'').toLowerCase())) errors.push('AI-agent family rules must use provider:family=allow|observe|deny');
  }
  if (config.aiAgentVerificationEnabled != null && typeof config.aiAgentVerificationEnabled !== 'boolean') errors.push('aiAgentVerificationEnabled must be boolean');
  intRange('aiAgentVerificationCacheMinutes',config.aiAgentVerificationCacheMinutes??360,5,1440);
  intRange('aiAgentVerificationTimeoutMs',config.aiAgentVerificationTimeoutMs??1500,250,10000);
  const aiAgentVerificationRules=config.aiAgentVerificationRules??[];
  if(!Array.isArray(aiAgentVerificationRules)) errors.push('aiAgentVerificationRules must be an array');
  else {
    if(aiAgentVerificationRules.length>32) errors.push('aiAgentVerificationRules must contain no more than 32 entries');
    for(const rule of aiAgentVerificationRules) if(!/^[a-z0-9_-]{2,32}:[a-z0-9_-]{2,64}@(verified|unverified|unavailable|disabled)=(allow|observe|deny)$/.test(String(rule||'').toLowerCase())) errors.push('AI-agent verification rules must use provider:family@verified|unverified|unavailable|disabled=allow|observe|deny');
  }
  if (config.aiAgentPolicyEnforcementEnabled && !config.aiAgentPolicyEnabled) errors.push('aiAgentPolicyEnforcementEnabled requires aiAgentPolicyEnabled');
  if (config.aiAgentPolicyEnforcementEnabled && config.aiAgentPolicyShadowMode) warnings.push('AI Agent Controls enforcement is enabled but AI-agent shadow mode is active, so declared-agent deny remains advisory.');
  if (config.aiAgentPolicyEnforcementEnabled && !config.aiAgentPolicyShadowMode) warnings.push('AI Agent Controls declared-agent deny is ACTIVE and request-scoped; allow does not grant trust or bypass other defenses.');
  if (config.blackholeEnabled && !config.proxyEnabled) warnings.push('robots blackhole is enabled without the reverse proxy; automatic robots.txt and hidden-link injection require proxy mode.');

  return { schemaVersion: CONFIG_SCHEMA_VERSION, valid: errors.length === 0, errors, warnings };
}
