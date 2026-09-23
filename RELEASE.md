# AnchorWeight v1.4.0 Release Guide

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

A v1.4.0 release should include the source ZIP and a SHA-256 checksum file. `SOURCE-MANIFEST.json` records SHA-256 hashes of reviewable source files.

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
