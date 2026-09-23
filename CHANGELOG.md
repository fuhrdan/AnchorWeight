# Changelog

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

