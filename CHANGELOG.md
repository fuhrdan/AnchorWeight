## 1.9.0 — Multi-Origin Routing & Release Hardening

- Added optional restart-only path-based routing to up to 16 explicitly approved HTTP(S) root origins.
- Kept AW_ORIGIN_URL as the default fallback, including live wizard changes to that default origin.
- Enforced longest segment-prefix matching, protected admin/trap endpoints, and fail-closed route validation.
- Prevented protocol-relative request paths from changing the configured proxy destination.
- Added per-route readiness checks and path-only routing metadata in the authenticated dashboard.
- Preserved v1.8 gateway controls, privacy boundaries, cPanel startup fix, and state schema v5.
- Kept routing OFF by default; no new runtime dependencies or automatic origin changes.

## 1.8.0 — Gateway Protection & Reliability

- Added opt-in IPv4/IPv6 CIDR access rules and per-IP fixed-window rate limits, including path-specific ceilings and shadow-only reporting.
- Gateway policies only apply when proxy mode is enabled, and do not alter Bot DNA scoring, signed canary evidence, or administrator/trap endpoints.
- Added optional bounded upstream HEAD probes and an opt-in HTTP 503 maintenance response for GET/HEAD transport failures.
- Added authenticated dashboard health and enforcement counters; existing JSON/SQLite state schema remains unchanged.
- Kept cPanel-compatible `app.js` initialization without top-level await. No additional npm runtime dependencies.

## v1.7.0 — Operator Setup Wizard & Traffic Telemetry

- Added a read-only-by-default browser setup flow for approved origins and proxy mode.
- Added bearer + CSRF authenticated validation/apply APIs, bounded HEAD probe,
  restricted private operator settings file, and live reverse-proxy swapping.
- Added aggregate in-memory traffic telemetry with five-minute trends, status
  classes, response timings, and active upstream/request gauges.
- Kept JSON/SQLite state schema v5 and previous detection, investigation,
  federation and cPanel startup semantics. No runtime npm dependencies added.

# Changelog

## [1.6.0] - 2026-09-23
- Optional signed, bounded, privacy-minimized evidence transport to a separately deployed hub.
- Authenticated multi-site evidence ingestion with timestamp/nonce replay protection,
  event deduplication and bounded append-only JSONL persistence.
- Hub read API returns evidence by site; no cross-site identity claims or remote enforcement.
- Default-off deployment; existing state schema 5 and cPanel startup behavior retained.
- Bounded in-memory publisher retries; unsent evidence may be lost on restart.

## [1.5.0] - 2026-09-23

- Introduced Investigation Console 2.0 with bounded chronological case timelines, filters, campaign drilldown and explained relationships.
- Added authenticated JSON and plain-text case reports with a conservative public event projection; signed canary paths are redacted.
- Added CSRF-protected, persistent analyst review statuses and bounded notes. Reviews do not silently change enforcement policy.
- Kept existing JSON/SQLite schema at v5, Node 22 cPanel startup compatibility and local protection behavior unchanged.


## 1.4.0
- Bot DNA 2.0 assessment: separate automation indicators, signed-trap evidence, and verified search-bot identity without changing existing scoring or enforcement defaults.
- Optional trusted-proxy JA4-compatible observation, saved as bounded keyed hashes only; missing values never incur risk points.
- Investigation console shows assessment and signal limitations. Backward-compatible JSON and SQLite state version 5; no migration.

## 1.3.0

- Independent signed canary branches, branch-level lineage and bounded per-profile evidence.
- Repeat-offender context and authenticated investigation response.
- Require authenticated signed path before cross-client campaign attribution; de-duplicate repeated shared-canary evidence.
- Preserve JSON/SQLite schema v5, cPanel startup fix and Shadow Mode defaults.


## 1.2.0 — Production reliability groundwork

- Optional dependency-free Node.js SQLite storage on Node 22.13+; JSON remains the default on Node 20/22/24.
- One-time transactional JSON-to-SQLite import, retaining original JSON as a rollback copy.
- Changed-row SQLite persistence rather than rewriting the full state after every event.
- SQLite-aware backups, local evidence reports, and state inspections; backend mismatch is rejected during restore.
- Storage backend and compatible state version exposed in the readiness response.
- SQLite migration, restart, corruption, expiration, and recovery regression coverage.
- Local repeatable HTTP benchmark utility and documented migration/rollback steps.

## 1.1.0

- Added robots-blackhole crawler detection alongside signed Proof-of-Crawl.
- Injects a hidden blackhole link into eligible proxied HTML responses.
- Appends the blackhole path to the site's existing `robots.txt`.
- Verified good bots and manually allowed identities bypass blackhole enforcement.
- Shadow Mode records would-quarantine activity without diverting traffic.
- Added blackhole hits, convictions, and would-quarantine metrics.
- Added dashboard visibility for blackhole telemetry.
- Prevented robots.txt body rewriting on redirects and `304 Not Modified` responses.
- Retained temporary, bounded quarantine rather than permanent IP bans.

## 1.0.0

- Formal configuration schema validation.
- Versioned state schema with supported migrations and fail-safe startup on corrupt/future state.
- `state-check`, `migrate`, and `release-check` CLI workflows.
- Broader isolated unit/security test suites.
- GitHub Actions CI across Node 20/22/24, `npm audit`, CodeQL, container build validation.
- Multi-stage non-root container build and hardened deployment presets.
- Architecture, threat model, configuration reference, release guide, and source manifest.
- All v0.9 production-hardening, investigation, campaign-intelligence, Bot DNA, Proof-of-Crawl, and Silent Quarantine features retained.
