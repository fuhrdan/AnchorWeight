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
  if (config.setupWritesEnabled && !config.setupConfigEnabled) errors.push('setupWritesEnabled requires setupConfigEnabled');
  if (config.setupWritesEnabled && !config.dashboardToken) errors.push('setupWritesEnabled requires an authenticated dashboard token');
  if (config.setupConfigEnabled) warnings.push('Operator configuration file may override only proxyEnabled and originUrl; disable AW_SETUP_CONFIG_ENABLED to ignore it.');
  if (config.trustProxy) warnings.push('trustProxy is enabled; only use it behind a trusted proxy that overwrites X-Forwarded-For.');
  if (config.trustedJa4Enabled && !config.trustProxy) errors.push('trustedJa4Enabled requires trustProxy');
  if (config.trustedJa4Enabled) warnings.push('trustedJa4Enabled requires the trusted TLS terminator to OVERWRITE X-AW-JA4 and strip client-supplied values.');
  if (config.allowQueryAdminToken) warnings.push('allowQueryAdminToken is enabled; bearer-only admin authentication is recommended.');
  if (config.scoreEnforcementEnabled) warnings.push('score-based enforcement is enabled; review Shadow Mode evidence before enabling in production.');
  if (config.blackholeEnabled && !config.proxyEnabled) warnings.push('robots blackhole is enabled without the reverse proxy; automatic robots.txt and hidden-link injection require proxy mode.');

  return { schemaVersion: CONFIG_SCHEMA_VERSION, valid: errors.length === 0, errors, warnings };
}
