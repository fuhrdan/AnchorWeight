# AnchorWeight v2.0.0 — Upgrade and Operations

## Scope and limitations

v2.0 consolidates v1.9 features; it does **not** add automatic cross-site identity inference, remote bans, zero-loss sensor delivery, or an HA database. Default JSON and optional SQLite remain **single-process** deployments. The intelligence hub is a separately deployed opt-in, single-writer evidence collector. Gateway rate limits are bounded per process, not distributed network-layer DDoS protection. Do not assume a site is protected unless real traffic passes through the proxy and the origin cannot be bypassed.

## HawkHost / cPanel upgrade from v1.9.0

1. Verify `git status`; note that `test/multi-origin.integration.test.js` was missing from the v1.9 Git tag but was in the v1.9 source ZIP. The v2 ZIP includes it. Preserve the existing file if it appears as untracked on HawkHost.
2. Stop the **sensor** Node app in Setup Node.js App. Archive the existing application privately (including local `data`, `.env`, and `.git`) and separately record cPanel environment settings. Do not put the archive in a public directory.
3. Extract the source archive into a staging directory and overlay its *contents* on the existing Git checkout. Never delete `.git`, `.env`, or `data` and never change `AW_SECRET` or `AW_DASHBOARD_TOKEN` as part of upgrading.
4. Activate the configured Node 22 environment. On resource-limited cPanel run `node --test --test-concurrency=1`; run `npm run release:verify` against the packaged files first, then `npm run release:check` only if you are deliberately rebuilding the source manifest. `release:check` writes; `release:verify` does not.
5. Keep `AW_ROUTES_ENABLED`, `AW_GATEWAY_ACCESS_ENABLED`, `AW_GATEWAY_RATE_ENABLED`, and `AW_INTELLIGENCE_ENABLED` at their **current values**. Do not enable protection as a side effect of upgrading. Keep browser configuration writes disabled unless previously deliberately enabled.
6. Start the app, verify `/live` reports `2.0.0`, `/ready` shows state schema 5, the dashboard and setup page load, and retained investigations are visible. Test `/anchor/` only from an approved test client.
7. Stage *only source files* including `test/multi-origin.integration.test.js`; inspect `git diff --cached --name-only`, then commit/push `main` and create/push the new `v2.0.0` tag **after** live verification. Do not use `git add .` in the live directory.

## Rollback

Stop the app, restore prior v1.9 source and restart with the original cPanel settings; only restore the earlier data files if you explicitly intend to roll back evidence recorded after upgrade. State schema v5 is unchanged. If SQLite was enabled, do not copy an active database with WAL files; stop the app or use its backup command.

## Release checks

- `node --test --test-concurrency=1` — complete suite, including legacy JSON and Node 22 SQLite startup/restart tests.
- `npm run release:verify` — compare expected source hashes with `SOURCE-MANIFEST.json` **without modifying it**. Excludes local `.env` files, `data/`, logs, backups, and databases.
- `npm run release:check` — intentionally rebuild the source manifest after code or documentation changes; review and commit the result.
- `npm audit --audit-level=high`, the GitHub Actions Node matrix, CodeQL, and the container build should be green before publishing the GitHub Release page.

## Security boundaries

Operator-file reads use a single bounded descriptor and disallow symlinks where the operating system supports `O_NOFOLLOW`. This is not a substitute for private directory permissions: keep `data/` inaccessible to other hosting users. Origin allowlists must still be curated by a human. Do not directly publish the hub admin token or use the local trap to claim that a distributed bot campaign's operators have been globally identified.
