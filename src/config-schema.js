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
  intRange('port', config.port, 1, 65535);
  intRange('blockDepth', config.blockDepth, 2, 8);
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

  if (config.trustProxy) warnings.push('trustProxy is enabled; only use it behind a trusted proxy that overwrites X-Forwarded-For.');
  if (config.allowQueryAdminToken) warnings.push('allowQueryAdminToken is enabled; bearer-only admin authentication is recommended.');
  if (config.scoreEnforcementEnabled) warnings.push('score-based enforcement is enabled; review Shadow Mode evidence before enabling in production.');

  return { schemaVersion: CONFIG_SCHEMA_VERSION, valid: errors.length === 0, errors, warnings };
}
