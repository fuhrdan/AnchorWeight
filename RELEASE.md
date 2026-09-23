# AnchorWeight v2.6.0 — Installation & Operator Experience

Upgrade from the **working, clean** v2.5.0 checkout. Stop the cPanel app, back up
the entire application and preserve cPanel environment variables separately.
Overlay the v2.6 source, run `node --test --test-concurrency=1` and
`npm run release:verify`, restart the same Node app, and verify `/live` reports
2.6.0, `/ready`, dashboard, wizard, and historical evidence. No automatic
configuration import or policy changes occur on upgrade.

Use [INSTALLATION-AND-OPERATIONS.md](INSTALLATION-AND-OPERATIONS.md) for first
install, read-only doctor, gateway-only export/import/rollback, and recovery.
Only after production checks pass: review staged files, commit, push `main`,
then create/push the v2.6.0 tag. Never stage `data/`, secrets, or backups.

---

# AnchorWeight v2.5.0 — Webhook Alerts & Typed Extension Hooks

Upgrade from a verified v2.4.0, preserving the app directory, Git checkout,
private `data/`, and cPanel environment. Keep `AW_ALERTS_ENABLED=false` for the
first restart. Run `node --test --test-concurrency=1` and
`npm run release:verify`; confirm `/live` reports 2.5.0 and the authenticated
Alerts & Webhooks dashboard reports disabled. Then publish the tested source.

To opt in, use `node bin/alerts.js init`, edit the private file, configure
an approved HTTPS hostname and a 32+ character signing key in cPanel, run
`node bin/alerts.js validate`, enable `AW_ALERTS_ENABLED=true`, and restart.
See [ALERTS-AND-WEBHOOKS.md](ALERTS-AND-WEBHOOKS.md). Alerts are best effort.

---

# AnchorWeight v2.3.0 — Circuit Breakers & Upstream Resilience

Upgrade from a verified v2.2.0 with the existing backup-first overlay. See
[UPSTREAM-RESILIENCE.md](UPSTREAM-RESILIENCE.md) for the opt-in breaker, health,
fallback configuration and rollback. Preserve your existing environment variables,
`data/` and Git checkout; **do not enable the new feature during the code upgrade**.

On Node 22, run `node --test --test-concurrency=1` and `npm run release:verify` before
restarting. Verify `/live` reports `2.3.0`, `/ready`, dashboard, wizard and evidence.
Only then commit and push the production-tested files and create the v2.3.0 tag.

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
