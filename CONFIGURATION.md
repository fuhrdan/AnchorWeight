# AnchorWeight Configuration Reference

AnchorWeight loads settings in this order:

```text
built-in defaults
      < named profile (`AW_PROFILE` / `--profile`)
      < pre-existing environment variables
      < CLI flags for the current process
```

Run `anchorweight config` to inspect the effective non-secret configuration and `anchorweight check` for schema validation.

## Core

| Environment | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listen port |
| `AW_SECRET` | ephemeral random | HMAC/fingerprint secret; must be persistent in production |
| `AW_BASE_PATH` | `/anchor` | Lure/admin API base path |
| `AW_SHADOW_MODE` | `true` | Observe without quarantine |
| `AW_BLOCK_DEPTH` | `3` | Sequential Proof-of-Crawl depth |
| `AW_BLOCK_MINUTES` | `60` | Initial temporary quarantine |
| `AW_REPEAT_BLOCK_MINUTES` | `1440` | Repeat-offense quarantine |
| `AW_QUARANTINE_MODE` | `decoy` | `decoy` or explicit `429` |

## Reverse proxy

| Environment | Default | Purpose |
| --- | --- | --- |
| `AW_PROXY_ENABLED` | `false` | Enable whole-site fixed-origin proxy |
| `AW_ORIGIN_URL` | `http://127.0.0.1:8081` | Private origin |
| `AW_PROXY_TIMEOUT_MS` | `15000` | Upstream timeout |
| `AW_PROXY_BODY_MAX_BYTES` | `26214400` | Maximum proxied request body |
| `AW_PUBLIC_SCHEME` | `https` | Forwarded public scheme |
| `AW_TRUST_PROXY` | `false` | Trust front-proxy source headers; only behind a trusted overwriting proxy |
| `AW_TRUSTED_JA4_ENABLED` | `false` | Optional informational JA4-compatible metadata from a trusted TLS proxy; requires `AW_TRUST_PROXY=true` and stripping/overwriting client `X-AW-JA4` |

## Administration

| Environment | Default | Purpose |
| --- | --- | --- |
| `AW_DASHBOARD_ENABLED` | `true` | Dashboard/API availability |
| `AW_DASHBOARD_TOKEN` | empty | Administrative bearer credential |
| `AW_ADMIN_RATE_LIMIT_PER_MINUTE` | `60` | Per keyed-client API limit |
| `AW_CSRF_TTL_MINUTES` | `15` | Operator mutation CSRF lifetime |
| `AW_ADMIN_BODY_MAX_BYTES` | `8192` | Mutation request-body bound |
| `AW_ALLOW_QUERY_ADMIN_TOKEN` | `false` | Legacy URL-token compatibility; avoid in production |
| `AW_AUDIT_ENABLED` | `true` | Admin audit trail |
| `AW_AUDIT_LOG_FILE` | `./data/anchorweight-audit.jsonl` | Audit path |

## Evidence and state

| Environment | Default | Purpose |
| --- | --- | --- |
| `AW_STATE_FILE` | `./data/anchorweight-state.json` | Versioned persistent state |
| `AW_LOG_FILE` | `./data/anchorweight-events.jsonl` | Behavioral event log |
| `AW_EVENT_RETENTION_DAYS` | `30` | Evidence retention |
| `AW_EVENT_MAX_MB` | `50` | Log rotation threshold |

## Detection

Score enforcement is disabled by default. See `.env.example` for individual signal weights. `AW_QUARANTINE_SCORE` defaults to `100`. Proof-of-Crawl at the configured depth can quarantine independently when Shadow Mode is disabled.

## Good bots

`AW_GOOD_BOT_VERIFICATION_ENABLED=true` verifies supported Google/Bing claims using reverse DNS followed by forward DNS confirmation. A failed or unavailable DNS check means unverified, not automatically malicious.

## Startup/readiness

| Environment | Default | Purpose |
| --- | --- | --- |
| `AW_READINESS_ORIGIN_CHECK` | `true` | Include origin reachability in `/ready` |
| `AW_SHUTDOWN_GRACE_MS` | `10000` | Graceful shutdown deadline |

Use `anchorweight release-check --profile production` before a production v1.0 deployment.

## Blackhole

AW_BLACKHOLE_ENABLED              true
AW_BLACKHOLE_PATH                 /anchor/blackhole
AW_BLACKHOLE_INJECT_LINK          true
AW_BLACKHOLE_MAX_RESPONSE_BYTES   2097152
AW_SCORE_BLACKHOLE                100

## v1.2.0: persistence backend

| Variable | Default | Description |
|---|---|---|
| `AW_STATE_BACKEND` | `json` | `json` (original) or `sqlite` (optional, Node 22.13+) |
| `AW_STATE_FILE` | `./data/anchorweight-state.json` | JSON state; also legacy import source when SQLite is first enabled |
| `AW_SQLITE_FILE` | `./data/anchorweight-state.sqlite` | SQLite state database (must differ from JSON path) |

SQLite is single-process only. The original JSON remains a point-in-time rollback
copy, not a continuously synchronized mirror. Read [SQLITE-MIGRATION.md](SQLITE-MIGRATION.md).

## v1.3 canary controls

`AW_CANARY_BRANCH_COUNT=7` (2–12) controls the number of independently signed branches displayed by each lure page. `AW_CANARY_VARIANTS_ENABLED=true` is the new default; `false` restores shared v1.2 link tokens with optional `?view=` labels. See [CANARY-EVIDENCE.md](CANARY-EVIDENCE.md).
