# AnchorWeight v2.4.0

**Let bots identify themselves.**

[![CI](https://github.com/fuhrdan/AnchorWeight/actions/workflows/ci.yml/badge.svg)](https://github.com/fuhrdan/AnchorWeight/actions/workflows/ci.yml)
[![CodeQL](https://github.com/fuhrdan/AnchorWeight/actions/workflows/codeql.yml/badge.svg)](https://github.com/fuhrdan/AnchorWeight/actions/workflows/codeql.yml)

AnchorWeight is a self-hosted defensive reverse proxy and crawler-identification system. It exposes a bounded procedural lure whose valid paths are cryptographically derived and must be traversed sequentially. A client that follows the issued path to the configured depth establishes **Proof-of-Crawl**. AnchorWeight can then observe that evidence in Shadow Mode or temporarily isolate the client behind inert HTTP 200 decoy responses while normal traffic continues to the private origin.

![AnchorWeight Dashboard](docs/images/anchorweight-dashboard.png)

> **The maze is not the weapon. The maze is the test.**

AnchorWeight is intentionally not an infinite tarpit, bandwidth sink, huge-file generator, or connection-exhaustion system.

## v2.3 Upstream Resilience (opt-in)

- Per-origin, process-local circuit breakers with independent failure thresholds and cooldowns.
- Optional bounded HEAD probes (two at a time), including configured fallback origins.
- Optional exact-match, allowlisted fallback mapping in a private `0600` JSON file.
- Only NEW bodyless GET/HEAD requests switch to fallbacks while a primary circuit is open. POST/PUT/PATCH/DELETE are never replayed or rerouted.
- HTTP 5xx responses contribute to opening a circuit but are returned unmodified; an in-flight failure is never retried.
- Per-path breaker state and fallback counts appear in the authenticated dashboard without origin URLs or secrets.
- Disabled by default; no state-schema migration or runtime dependencies. See [UPSTREAM-RESILIENCE.md](UPSTREAM-RESILIENCE.md).

## v2.1 Unified Gateway Configuration & Route Wizard

- Optional, private JSON or safe-subset YAML config for the proxy switch, approved default origin and up to 16 path routes. No additional npm dependencies or state migration.
- Authenticated Setup Wizard route editor, bounded upstream HEAD validation, CSRF-protected live apply and previous-file rollback; file writes remain disabled until explicitly enabled.
- Legacy environment, v1.7 operator settings and v1.9 route files remain supported with declarative mode off; conflicting modes fail validation if accidentally enabled together.
- **Secrets, crawler enforcement, gateway rate/IP rules and health policy are not editable through the declarative file.** See [DECLARATIVE-CONFIGURATION.md](DECLARATIVE-CONFIGURATION.md) for migration and rollback.

## v2.2 Application Authentication & Security Policies

- Opt-in per-path HTTP Basic Auth and API keys for proxied applications; independent of dashboard authentication and Bot DNA.
- Offline credential CLI produces scrypt password verifiers or one-time 256-bit API keys; private on-disk credentials file is fail-closed when enabled.
- Longest segment-prefix policy selection, bounded async hashing, HTTP 401 challenges, stripped credentials before forwarding, and authenticated policy-only dashboard counters.
- Existing per-path gateway rate-limit controls continue to work independently. No new runtime dependencies or state migration.
- See [APPLICATION-AUTH.md](APPLICATION-AUTH.md) for installation, rotation, trust boundaries and rollback.

## v2.4 Live Traffic Observatory

- In-memory, per-process, bounded per-route response metrics with approximate p50/p95/p99 latency and sanitized transport-error counts.
- Redacted last 50 proxied-response events in authenticated stats; no raw paths, IPs, authorization data or upstream URLs.
- Optional, read-only WebSocket event stream with one-use, 30-second tickets issued by the authenticated admin API.
- Disabled by default. No new runtime dependencies, state-schema changes or required routing changes.
- [Installation and operator guide](LIVE-TRAFFIC-OBSERVATORY.md).

## v2.0 Integrated Defensive Security Platform

The v2.0 milestone consolidates local crawler evidence, opt-in multi-origin gateway controls, operator setup, telemetry, and optional authenticated intelligence reporting. **The hub is an evidence collector, not global crawler identity or a remote enforcement system.** Legacy JSON is still the default; SQLite requires Node 22.13+.

- Source integrity: `npm run release:check` writes the manifest; `npm run release:verify` **checks without changing files** and is used by CI.
- Operator configuration: bounded (16 KiB) descriptor-backed local settings reads, refusing symlinks where the platform supports `O_NOFOLLOW`.
- v1.9's previously uncommitted `test/multi-origin.integration.test.js` is included in the v2.0 release.
- No automatic proxy enabling, new runtime dependencies, or state schema changes.
- See [V2-OPERATIONS.md](V2-OPERATIONS.md) for the upgrade and rollback process and limitations.

## v1.7 Operator Setup Wizard & Traffic Telemetry

- Authenticated `/setup.html` wizard with an explicit opt-in before browser
  changes can apply; no environment-file rewriting or arbitrary origin access.
- cPanel-approved, exact-match origins, server-side configuration validation,
  bounded origin HEAD probe, CSRF-protected apply, and private atomic local
  settings for restart persistence. Credentials and enforcement policy stay in
  cPanel. Disabling the feature restores environment-specified routing.
- New bounded per-process telemetry reports request totals, final status
  classes, active requests/upstreams, mean response time, upstream first-header
  latency and five-minute traffic trends. No request identities are stored.
- Existing JSON/SQLite schema v5, cPanel startup compatibility, distributed
  evidence reporting and dashboard investigation features remain unchanged.
- See [OPERATOR-GATEWAY.md](OPERATOR-GATEWAY.md) before enabling proxy mode.

## v1.8 Gateway Protection & Reliability

- Optional, independent access-rule and per-IP rate-limit gates for **proxied traffic only**, disabled by default.
- IPv4/IPv6 CIDR allow and deny rules, shadow-mode counters and optional bounded path-specific request limits.
- Optional bounded upstream HEAD health probes and opt-in 503 maintenance responses for transport errors on GET/HEAD.
- Authenticated dashboard displays access, rate and upstream status without leaking IPs or paths.
- No new runtime dependencies or state migration; [operator guide](GATEWAY-PROTECTION.md).

## v1.9 Multi-Origin Routing

- Optional private route-file mapping of approved URL path prefixes to up to 16 distinct origins.
- Existing `AW_ORIGIN_URL` remains the default fallback, including via the existing setup wizard.
- Route table is validated at startup and is restart-only; no external HTTP request can select an arbitrary upstream.
- Authenticated dashboard displays path-only route status; `/ready` checks the default and each configured route.
- Existing client evidence and JSON/SQLite state schema v5 are unchanged.
- See [Multi-origin routing and rollback](MULTI-ORIGIN-ROUTING.md).

## v1.6 Distributed Intelligence Foundation

- Separate, authenticated evidence-ingestion hub, disabled by default.
- Explicit per-site registration; independently configured federation secret.
- Private signed paths and internal IP keys never cross the federation boundary.
- Locally verified evidence summaries, bounded asynchronous queue, and hub ingestion deduplication.
- Sensor dashboard displays distributed publisher queue/sent/drop status.
- No automatic cross-site identity inference or remote enforcement.
- [Distributed intelligence deployment guide](DISTRIBUTED-INTELLIGENCE.md).

## v1.5 Investigation Console 2.0

- Searchable, bounded Bot DNA and campaign investigation timelines and relationship evidence.
- Authenticated JSON and plain-text case reports with signed-path redaction.
- Explicit, CSRF-protected analyst reviews separate from enforcement policy.
- [Investigation Console 2.0 guide](INVESTIGATION-CONSOLE-2.md).

## Security Engineering Evidence

AnchorWeight is designed as a **bounded defensive control**, not as a resource-exhaustion mechanism. Its security model emphasizes observable crawler behavior, explicit trust boundaries, reversible enforcement, and conservative defaults.

| Area                                | Evidence                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Threat model**                    | [THREAT-MODEL.md](THREAT-MODEL.md) documents protected assets, adversaries, trust assumptions, controls, abuse cases, and residual risks            |
| **Architecture / trust boundaries** | [ARCHITECTURE.md](ARCHITECTURE.md) documents request flow, origin isolation, administrative surfaces, crawler evidence, and enforcement boundaries  |
| **Safe rollout**                    | Shadow Mode is enabled by default; proxy and score enforcement remain disabled until an operator deliberately enables them                          |
| **Crawler evidence**                | Proof-of-Crawl uses signed sequential paths rather than treating ordinary browsing behavior as automatic proof of abuse                             |
| **Good-bot verification**           | Claimed Google/Bing identities are verified using reverse and forward DNS rather than trusted from User-Agent strings alone                         |
| **Bounded enforcement**             | Convicted traffic receives deterministic inert HTTP 200 decoys rather than unbounded files, connection exhaustion, or infinite resource consumption |
| **State integrity**                 | Schema compatibility checks and explicit migrations fail closed on corrupt, unsupported-old, or future-version state                                |
| **Release gates**                   | Tests, `npm audit`, release validation, CodeQL, container builds, configuration checks, and runtime diagnostics support production readiness        |

### Safe-by-Default Operating Model

```text
Observe
   ↓
Shadow Mode
   ↓
Collect crawler evidence
   ↓
Verify legitimate automation
   ↓
Review policy
   ↓
Deliberately enable enforcement
   ↓
Temporary, bounded quarantine
```

AnchorWeight intentionally separates **detection evidence** from **enforcement policy**.

A crawler classification, behavioral score, or campaign correlation does not need to become an automatic permanent block. This matters because shared NAT, VPN, mobile, and enterprise egress addresses can represent multiple unrelated users.

The preferred operating model is therefore:

* observe before enforcing;
* use layered evidence rather than one heuristic;
* distinguish verified good bots from unverified identities;
* make quarantine temporary and reversible;
* keep the real origin private;
* preserve evidence and audit history;
* fail safely when configuration or state integrity cannot be established.

## Security Boundary

For Silent Quarantine to provide meaningful isolation, the protected origin must not remain directly reachable from the public Internet.

```text
Internet
   ↓
AnchorWeight
   ├── trusted / normal traffic ──→ private origin
   └── quarantined traffic ──────→ deterministic decoy
```

If clients can bypass AnchorWeight and reach the origin directly, the reverse proxy cannot enforce the intended boundary.

## v1.0.0 highlights

- Signed, sequential **Proof-of-Crawl** procedural lure.
- Whole-site fixed-origin HTTP/HTTPS reverse proxy.
- **Silent Quarantine** with deterministic inert HTML/JSON responses.
- Privacy-conscious **Bot DNA** behavioral profiles.
- Verified Google/Bing crawler claims using reverse + forward DNS confirmation.
- Distributed-crawler **Bot Campaign** correlation using shared signed-canary evidence.
- Investigation dashboard with event explorer, campaign map, timelines, and explicit allow/quarantine policy controls.
- Zero-runtime-dependency operator CLI.
- Named Shadow/Production configuration profiles.
- Log rotation/retention, backup/restore, evidence reports, liveness/readiness, and graceful shutdown.
- Bearer-only admin authentication by default, CSRF-protected mutations, admin rate limiting, audit logging, and request-body bounds.
- **Formal configuration schema v1** and **state schema v5** with supported migrations.
- `state-check`, `migrate`, and `release-check` upgrade/release gates.
- Expanded unit, security, integration, persistence, and proxy test coverage.
- GitHub Actions CI, `npm audit`, CodeQL, and container-build validation.
- Non-root multi-stage Docker image plus cPanel, systemd, Nginx/Apache, and Docker deployment examples.

## v1.1.0 highlights

- **Robots Blackhole** detection using a hidden link explicitly disallowed by `robots.txt`.
- Blackhole evidence feeds the existing Bot DNA and temporary quarantine system.
- Verified good bots and explicit allow policies remain exempt.
- Shadow Mode can measure blackhole activity before enforcement.
- Dashboard metrics for blackhole hits, convictions, and would-quarantine events.
- Existing signed sequential Proof-of-Crawl remains the stronger deep-traversal signal.

## v1.2.0 highlights

- **Optional SQLite persistence** on Node 22.13+, with zero additional npm runtime dependencies.
- Existing JSON deployment remains the default; Node 20 installations are not forced to upgrade.
- Transactional JSON-to-SQLite import; the legacy JSON file remains unchanged for rollback.
- Changed-row persistence and SQLite-aware backup, restore, inspection, and reporting.
- Local benchmark script, expanded regression tests, and storage documentation.

**Start with [SQLITE-MIGRATION.md](SQLITE-MIGRATION.md) before enabling SQLite on a live site.**

## Bot DNA 2.0 (v1.4.0)

See [BOT-DNA-2.md](BOT-DNA-2.md) for explainable evidence and optional trusted TLS fingerprint ingestion. The additional observations do not alter risk points or enforcement defaults.

## v1.3.0 highlights

- **Independently signed canary branches:** each displayed lure link has its own authenticated token; branch zero remains backward compatible with v1.2 signed paths.
- **Session lineage:** bounded event records capture branch, depth, elapsed time and opaque session IDs without logging signed URL tokens or raw IPs.
- **Evidence ledger:** recent structured observations appear on the existing authenticated investigation API and persist with Bot DNA profiles in both JSON and SQLite.
- **Repeat-offender context:** profile offense counts and last-offense timestamps survive restart through the existing state backends.
- **Stronger campaign attribution:** cross-client campaign correlation requires a valid signed chain, and repeated use of the same session cannot repeatedly inflate campaign confidence.
- **Configurable traps:** `AW_CANARY_BRANCH_COUNT` (2–12) and `AW_CANARY_VARIANTS_ENABLED` (default true). Shadow Mode and manual allow policies are unchanged.

See [CANARY-EVIDENCE.md](CANARY-EVIDENCE.md) for rollout, privacy boundaries, limitations and rollback.

## Architecture

```text
                         Internet
                            |
                    trusted front proxy
                      (optional)
                            |
                            v
                    +----------------+
                    |  AnchorWeight  |
                    +----------------+
                      |     |      |
      /anchor lure ---+     |      +--- admin/dashboard
                            |
              +-------------+-------------+
              |                           |
        normal/trusted                convicted
           traffic                     crawler
              |                           |
              v                           v
       PRIVATE ORIGIN              HTTP 200 DECOY
                                    origin hidden
```

For the detailed module/trust-boundary description, see [ARCHITECTURE.md](ARCHITECTURE.md) and [THREAT-MODEL.md](THREAT-MODEL.md).

## Safe defaults

```env
AW_SHADOW_MODE=true
AW_PROXY_ENABLED=false
AW_SCORE_ENFORCEMENT_ENABLED=false
AW_GOOD_BOT_VERIFICATION_ENABLED=true
AW_ALLOW_QUERY_ADMIN_TOKEN=false
```

The recommended rollout is **Shadow Mode first**, inspect real traffic, verify legitimate automation/good bots, then deliberately enable Proof-of-Crawl enforcement. Score-only enforcement remains opt-in.

## Quick start

Requirements: Node.js 20+.

```bash
npm ci --ignore-scripts
npm test

export AW_SECRET='replace-with-a-long-persistent-random-secret'
export AW_DASHBOARD_TOKEN='replace-with-a-long-random-admin-token'

node bin/anchorweight.js check --profile shadow --origin http://127.0.0.1:8081
node bin/anchorweight.js start --profile shadow --origin http://127.0.0.1:8081
```

Then visit:

```text
/dashboard.html
/live
/ready
```

For cPanel hosting, see `deploy/cpanel/README.md`; normal setup uses **Setup Node.js App** with `app.js` as the startup file and environment variables configured in the cPanel UI.

## CLI

```text
start           Start AnchorWeight
check           Validate effective configuration
config          Print redacted effective configuration
profile-list    List named profiles
status          Query a running instance
doctor          Diagnose configuration, live service, API, and origin
profiles        Show Bot DNA profiles
campaigns       Show crawler campaigns
events          Search recent evidence
investigate     Inspect a Bot DNA/campaign timeline
policy          Allow/quarantine/clear a Bot DNA policy
trap-test       Walk a real signed lure chain
backup          Back up state/evidence
restore         Restore a backup
report          Export bounded evidence JSON
prune           Apply retention
state-check     Inspect state-schema compatibility
migrate         Upgrade supported state to v1 schema
release-check   Run config/state release readiness checks
```

See [CLI.md](CLI.md) for flags and examples.

## Upgrading from v0.8/v0.9

Back up before migration:

```bash
anchorweight state-check --profile production
anchorweight migrate --profile production --dry-run
anchorweight backup --profile production --dest ./backups
anchorweight migrate --profile production
```

Supported old state versions are migrated sequentially to the v1.0 state schema. A corrupt, unsupported-old, or future-version state file causes startup to fail instead of silently starting with empty protection history.

## Production release gate

```bash
npm ci --ignore-scripts
npm test
npm audit --audit-level=high
npm run release:check

anchorweight check --profile production --origin http://127.0.0.1:8081
anchorweight release-check --profile production
anchorweight doctor \
  --profile production \
  --origin http://127.0.0.1:8081 \
  --url http://127.0.0.1:8080 \
  --token "$AW_DASHBOARD_TOKEN"
```

The real origin must be private or otherwise inaccessible from the public Internet for whole-site Silent Quarantine to be meaningful.

## Testing and security automation

`npm test` runs isolated module/security tests plus the existing end-to-end proxy, persistence, Proof-of-Crawl, Bot DNA, good-bot, campaign, CLI, and operations regression tests.

GitHub workflows provide:

- Node.js 20/22/24 test matrix.
- `npm audit --audit-level=high` software-composition gate.
- release/source-manifest validation.
- CodeQL JavaScript/TypeScript scanning.
- Docker image build validation.

AnchorWeight has no runtime npm dependencies in v1.2.0, but the audit gate is kept in place so future dependency additions do not silently bypass SCA.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — modules, request path, trust boundaries.
- [THREAT-MODEL.md](THREAT-MODEL.md) — assets, adversaries, controls, residual risks.
- [CONFIGURATION.md](CONFIGURATION.md) — configuration reference and precedence.
- [CLI.md](CLI.md) — operator command/flag reference.
- [OPERATIONS.md](OPERATIONS.md) — profiles, retention, backup/restore, lifecycle.
- [DEPLOYMENT.md](DEPLOYMENT.md) — proxy and hosting deployment guidance.
- [SECURITY.md](SECURITY.md) — security posture and reporting guidance.
- [RELEASE.md](RELEASE.md) — v1 release/upgrade checklist.
- [CHANGELOG.md](CHANGELOG.md) — release summary.

## Important limitations

AnchorWeight v1.0 supports a **single process / single local state writer**. The JSON persistence layer is not a distributed datastore. Shared NAT/VPN/mobile IPs can represent multiple users, so AnchorWeight uses temporary quarantine and layered evidence rather than permanent IP bans. Good-bot DNS failure means unverified, not automatically malicious. Bot Campaign correlation is informational by default and does not automatically quarantine an entire cluster.

## License

MIT

## Optional distributed intelligence (v1.6.0)

Run `node bin/intelligence-hub.js` as a **separate Node application** with its own
credentials and storage; see [DISTRIBUTED-INTELLIGENCE.md](DISTRIBUTED-INTELLIGENCE.md).
The normal sensor is unchanged by default (`AW_INTELLIGENCE_ENABLED=false`).
The hub aggregates site-scoped evidence but **does not** automatically associate
profiles across different sites or apply policies. These are local attestations,
not independent proof of common operator identity.
