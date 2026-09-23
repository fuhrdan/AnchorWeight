# AnchorWeight v2.2.0 — Application Authentication & Security Policies

Upgrade from v2.1.0 with the existing backup-first overlay. See
[APPLICATION-AUTH.md](APPLICATION-AUTH.md). Installation does NOT turn on
application authentication, the reverse proxy, rate limiting or crawler
enforcement. Preserve cPanel environment variables and the private `data/` folder.

Run `node --test --test-concurrency=1` and `npm run release:verify` on Node 22
before restarting. Verify `/live` (2.2.0), `/ready`, dashboard, wizard and evidence.
Commit, push and tag only after production checks pass.

---

# AnchorWeight v2.0.0 — Integration & Production Hardening

See [V2-OPERATIONS.md](V2-OPERATIONS.md) for exact deployment, rollback, security boundaries, and limitations. Run `npm run release:verify` for a non-mutating source-integrity check after `npm run release:check`. The v1.9 single-origin and default-disabled routing behavior remains unchanged.

# AnchorWeight v1.9.0 — Multi-Origin Routing & Release Hardening

Start with [MULTI-ORIGIN-ROUTING.md](MULTI-ORIGIN-ROUTING.md). The new route engine
is disabled by default, so an existing v1.8 installation keeps its current proxy,
state, and cPanel settings. The existing cPanel-compatible app.js entrypoint is retained.

# AnchorWeight v1.7.0 — Operator Setup Wizard & Traffic Telemetry

Use `OPERATOR-GATEWAY.md` for the first deployment. Web configuration is opt-in;
new deployments and upgrades retain existing cPanel proxy/enforcement settings.

# AnchorWeight v1.5.0 Release Guide

## Pre-release gate

```bash
npm ci --ignore-scripts
npm test
npm audit --audit-level=high
npm run release:check
anchorweight check --profile production
anchorweight release-check --profile production
```

If upgrading an existing state file:

```bash
anchorweight state-check --profile production
anchorweight migrate --profile production --dry-run
anchorweight backup --profile production --dest ./backups
anchorweight migrate --profile production
```

`migrate` creates a pre-v1 backup before modifying an older supported state file.

## Deployment gate

1. Start/upgrade in Shadow Mode when practical.
2. Verify `/live` and `/ready`.
3. Run `anchorweight doctor` against the running instance.
4. Verify the dashboard with the bearer credential.
5. Execute `trap-test` only from a test source you are willing to classify as a crawler.
6. Verify that the private origin cannot be bypassed from the public Internet.
7. Review Bot DNA/campaign evidence before score enforcement.

## Release artifacts

A v1.5.0 release should include the source ZIP and a SHA-256 checksum file. `SOURCE-MANIFEST.json` records SHA-256 hashes of reviewable source files.

## v1.2.0 SQLite release considerations

Test both default JSON and opt-in SQLite on Node 22/24. Existing Node 20
installs retain JSON without loading `node:sqlite`. Verify a migrated JSON
profile and campaign, consistent SQLite backup, and successful restore while
stopped. Benchmark representative requests in Shadow Mode before enabling
enforcement on an existing site.

## v1.3 additional release gates

- Independent branch token and tamper/replay handling tests.
- Signed-chain validation precedes cross-IP campaign correlation.
- Profile evidence and offense context persist with JSON/SQLite.
- On HawkHost shared hosting use `node --test --test-concurrency=1`.
- Preserve the v1.2 cPanel `async main()` startup fix.

## v1.5 investigation release gates

- Verify dashboard JavaScript syntax, authenticated investigation/report API, and CSRF review.
- Check public reports contain no raw IP-key or signed canary URL token.
- Verify JSON and SQLite review persistence with state schema v5.
- Run on HawkHost with `node --test --test-concurrency=1`.
- Review `INVESTIGATION-CONSOLE-2.md` before deployment.
