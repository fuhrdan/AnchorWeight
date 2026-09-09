export const FLAG_MAP = {
  '--port': 'PORT',
  '--origin': 'AW_ORIGIN_URL',
  '--base-path': 'AW_BASE_PATH',
  '--dashboard-token': 'AW_DASHBOARD_TOKEN',
  '--block-depth': 'AW_BLOCK_DEPTH',
  '--quarantine-score': 'AW_QUARANTINE_SCORE',
  '--public-scheme': 'AW_PUBLIC_SCHEME',
  '--block-minutes': 'AW_BLOCK_MINUTES',
  '--repeat-block-minutes': 'AW_REPEAT_BLOCK_MINUTES',
  '--proxy-timeout-ms': 'AW_PROXY_TIMEOUT_MS',
  '--profile': 'AW_PROFILE',
  '--event-retention-days': 'AW_EVENT_RETENTION_DAYS',
  '--event-max-mb': 'AW_EVENT_MAX_MB',
  '--admin-rate-limit': 'AW_ADMIN_RATE_LIMIT_PER_MINUTE',
  '--admin-body-max-bytes': 'AW_ADMIN_BODY_MAX_BYTES',
  '--proxy-body-max-bytes': 'AW_PROXY_BODY_MAX_BYTES',
  '--shutdown-grace-ms': 'AW_SHUTDOWN_GRACE_MS'
};

export const BOOL_FLAGS = {
  '--proxy': ['AW_PROXY_ENABLED', 'true'],
  '--no-proxy': ['AW_PROXY_ENABLED', 'false'],
  '--shadow': ['AW_SHADOW_MODE', 'true'],
  '--enforce': ['AW_SHADOW_MODE', 'false'],
  '--score-enforcement': ['AW_SCORE_ENFORCEMENT_ENABLED', 'true'],
  '--no-score-enforcement': ['AW_SCORE_ENFORCEMENT_ENABLED', 'false'],
  '--trust-proxy': ['AW_TRUST_PROXY', 'true'],
  '--no-trust-proxy': ['AW_TRUST_PROXY', 'false'],
  '--dashboard': ['AW_DASHBOARD_ENABLED', 'true'],
  '--no-dashboard': ['AW_DASHBOARD_ENABLED', 'false'],
  '--good-bot-verification': ['AW_GOOD_BOT_VERIFICATION_ENABLED', 'true'],
  '--no-good-bot-verification': ['AW_GOOD_BOT_VERIFICATION_ENABLED', 'false'],
  '--allow-query-admin-token': ['AW_ALLOW_QUERY_ADMIN_TOKEN', 'true'],
  '--no-query-admin-token': ['AW_ALLOW_QUERY_ADMIN_TOKEN', 'false'],
  '--audit': ['AW_AUDIT_ENABLED', 'true'],
  '--no-audit': ['AW_AUDIT_ENABLED', 'false'],
  '--readiness-origin-check': ['AW_READINESS_ORIGIN_CHECK', 'true'],
  '--no-readiness-origin-check': ['AW_READINESS_ORIGIN_CHECK', 'false']
};

export function parseStartFlags(args) {
  const env = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (BOOL_FLAGS[arg]) {
      const [name, value] = BOOL_FLAGS[arg];
      env[name] = value;
      continue;
    }
    if (FLAG_MAP[arg]) {
      const value = args[++i];
      if (value == null || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      env[FLAG_MAP[arg]] = value;
      continue;
    }
    throw new Error(`Unknown flag: ${arg}`);
  }
  return env;
}
