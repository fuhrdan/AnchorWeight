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

## v2.3 opt-in per-origin resilience

`AW_RESILIENCE_ENABLED=false` leaves all existing proxy behavior unchanged.
Set the following only after validating the equivalent fallback application:

| Variable | Default | Description |
|---|---|---|
| `AW_RESILIENCE_ENABLED` | `false` | Opt-in per-origin breaker |
| `AW_RESILIENCE_FAILURE_THRESHOLD` | `3` | Consecutive HTTP 5xx/transport errors to open (2–20) |
| `AW_RESILIENCE_COOLDOWN_MS` | `30000` | Open-state cooldown before one half-open read probe (1000–300000) |
| `AW_RESILIENCE_HEALTH_ENABLED` | `false` | Independent per-origin HEAD probes; requires resilience enabled |
| `AW_RESILIENCE_HEALTH_INTERVAL_MS` | `30000` | Probe interval (5000–300000) |
| `AW_RESILIENCE_HEALTH_TIMEOUT_MS` | `2000` | Probe timeout (500–10000) |
| `AW_RESILIENCE_FALLBACKS_FILE` | empty | Optional private `0600` JSON file under `./data` |
| `AW_RESILIENCE_ALLOWED_ORIGINS` | empty | Exact comma-delimited operator-approved fallback origins |

See [UPSTREAM-RESILIENCE.md](UPSTREAM-RESILIENCE.md) for fallbacks, limits and rollback.

## AI Agent Controls (v3.1)

AI Agent Controls are enabled for observation by default and remain shadowed until explicitly activated. Core settings: AW_AI_AGENT_POLICY_ENABLED, AW_AI_AGENT_POLICY_SHADOW_MODE, AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED, AW_AI_AGENT_TRAINING_ACTION, AW_AI_AGENT_SEARCH_ACTION, AW_AI_AGENT_USER_ACTION, AW_AI_AGENT_AUTOMATION_ACTION, and AW_AI_AGENT_FAMILY_RULES. See AI-AGENT-CONTROLS.md for semantics and examples.

### Verified AI-Agent Identity (v3.1 alpha.2)

AW_AI_AGENT_VERIFICATION_ENABLED enables observational verification using provider-published network ranges when trusted client identity is available. AW_AI_AGENT_VERIFICATION_CACHE_MINUTES controls the in-process range cache and AW_AI_AGENT_VERIFICATION_TIMEOUT_MS bounds provider feed fetches. Verification never grants trust and does not change alpha.1 request-scoped deny behavior.


<!-- v3.1-alpha.3 verification-aware-policy -->
## v3.1 alpha.3 — verification-aware AI policy

Exact verification-status overrides are configured with `AW_AI_AGENT_VERIFICATION_RULES`, using `provider:family@status=allow|observe|deny`. If no exact rule matches, AnchorWeight preserves the alpha.1 declaration policy; verified identity never grants trust. See `VERIFICATION-AWARE-AI-POLICY.md`.

## v3.1 alpha.4 AI-agent observability

No new environment variables are required. AI-agent observability is authenticated, process-local, bounded, non-enforcing, and resets when the Node process restarts.

<!-- v3.1-alpha.5 policy-manager -->
## AI Agent Policy Manager (v3.1 alpha.5)

The dashboard policy manager edits a staged draft and exports canonical AW_AI_AGENT_* environment settings. Export is deliberately shadow-first and always sets AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=false. Applying exported settings and any later enforcement transition remain separate deployment actions.

<!-- v3.1-alpha.6 controlled-policy-deployment -->
## Controlled AI policy deployment (v3.1 alpha.6)

The dashboard can prepare a private shadow-only environment from the saved AI-agent policy draft plus a rollback snapshot. Generated candidate and rollback environments always set AW_AI_AGENT_POLICY_SHADOW_MODE=true and AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=false. Applying those values to cPanel and restarting Node/Passenger remain explicit external operator actions.


<!-- v3.1-alpha.7-ai-burnin-readiness -->
## v3.1 alpha.7 — AI-agent burn-in and beta-review readiness

Alpha.7 adds a consolidated offline burn-in gate, `npm run ai-agents:burnin-check`, that re-runs the full v3.1 AI control stack, validates all 12 declared-agent family canaries, verifies the frozen v3.0 contract/privacy/action ladder, and checks alpha.6 shadow deployment safety. A PASS means ready for v3.1 beta review; it does not grant enforcement readiness. See `AI-AGENT-BURNIN-READINESS.md`.


<!-- v3.1-beta.1-stabilization -->
## v3.1 beta.1 — AI-agent stabilization and validation

Beta.1 promotes the alpha.1-alpha.7 AI-agent stack into stabilization without adding enforcement behavior. Run `npm run ai-agents:burnin-check` followed by `npm run ai-agents:beta-check`, then security and release check/verify. The beta verdict does not grant enforcement readiness and does not change trusted-client-identity requirements. See `AI-AGENT-BETA-VALIDATION.md`.


<!-- v3.1-beta.2-production-shadow-validation -->
## v3.1 beta.2 — Production shadow validation

Beta.2 adds a read-only production validation harness. Run `npm run ai-agents:beta2-check` before deployment, then explicitly run `npm run ai-agents:production-check` against the shadow-mode deployed instance. The live validator never enables enforcement, edits hosting configuration, or restarts the application. Dashboard credentials are accepted only through `AW_PRODUCTION_DASHBOARD_TOKEN`. See `AI-AGENT-PRODUCTION-SHADOW-VALIDATION.md`.
