## v2.6 operator workflow

See [INSTALLATION-AND-OPERATIONS.md](INSTALLATION-AND-OPERATIONS.md) for
`npm run setup`, read-only `npm run doctor`, and gateway-only config
export/import/rollback commands. The original `anchorweight doctor` is retained
for legacy compatibility; prefer `npm run doctor` for a **read-only** check.

# AnchorWeight v1.2.0 CLI

AnchorWeight ships a zero-runtime-dependency operator CLI:

```text
anchorweight <command> [flags]
```

If the package is not installed globally, use `node bin/anchorweight.js` in place of `anchorweight`.

## Commands

| Command | Purpose |
| --- | --- |
| `start` | Start AnchorWeight; default command |
| `check` | Validate the effective configuration against config schema v1 |
| `config` | Print effective configuration with secrets redacted |
| `profile-list` | List named profiles |
| `status` | Query a running instance |
| `doctor` | Diagnose config, filesystem, origin, `/live`, `/ready`, and API auth |
| `profiles` | Show highest-risk Bot DNA profiles |
| `campaigns` | Show distributed crawler campaigns |
| `events` | Filter recent evidence events |
| `investigate` | Show one Bot DNA/campaign evidence timeline |
| `policy` | Explicitly allow, quarantine, or clear one Bot DNA policy |
| `trap-test` | Walk an actual signed Proof-of-Crawl chain |
| `backup` | Back up state/evidence files with a manifest |
| `restore` | Restore a backup directory; stop the service first |
| `report` | Export a bounded JSON evidence report |
| `prune` | Apply configured event retention immediately |
| `state-check` | Inspect state-file schema compatibility |
| `migrate` | Migrate supported old state to v1 state schema |
| `release-check` | Validate config/state readiness for a v1 deployment |
| `help` | Show command help |
| `version` | Print AnchorWeight version |

## Configuration precedence

```text
built-in defaults
       < named profile
       < existing environment
       < command-line flags
```

Example:

```bash
anchorweight start --profile shadow --origin http://127.0.0.1:8081 --no-score-enforcement
```

## Core start flags

```text
--port <n>
--origin <url>
--proxy | --no-proxy
--shadow | --enforce
--base-path <path>
--dashboard-token <token>
--block-depth <2-8>
--block-minutes <n>
--repeat-block-minutes <n>
--score-enforcement | --no-score-enforcement
--quarantine-score <n>
--trust-proxy | --no-trust-proxy
--public-scheme <http|https>
--proxy-timeout-ms <n>
--dashboard | --no-dashboard
--good-bot-verification | --no-good-bot-verification
--profile <name>
--event-retention-days <n>
--event-max-mb <n>
--admin-rate-limit <n>
--admin-body-max-bytes <n>
--proxy-body-max-bytes <n>
--shutdown-grace-ms <n>
--audit | --no-audit
--allow-query-admin-token | --no-query-admin-token
--readiness-origin-check | --no-readiness-origin-check
```

For production, prefer environment variables for secrets instead of putting them on a shared shell command line:

```bash
export AW_SECRET='...'
export AW_DASHBOARD_TOKEN='...'
anchorweight start --profile production --origin http://127.0.0.1:8081
```

## Validate before starting

```bash
anchorweight check --profile shadow --origin http://127.0.0.1:8081
anchorweight config --profile shadow --origin http://127.0.0.1:8081
```

`check` returns non-zero when formal configuration errors exist. Warnings call attention to risky but intentionally supported choices such as `AW_TRUST_PROXY=true`, URL admin tokens, or score enforcement.

## Diagnose a deployment

Local/config-only checks:

```bash
anchorweight doctor --profile shadow --origin http://127.0.0.1:8081
```

Running-instance checks:

```bash
anchorweight doctor \
  --profile production \
  --origin http://127.0.0.1:8081 \
  --url http://127.0.0.1:8080 \
  --token "$AW_DASHBOARD_TOKEN"
```

## Investigate

```bash
anchorweight status --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN"
anchorweight profiles --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN"
anchorweight campaigns --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN"
anchorweight events --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN" --limit 50
anchorweight events --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN" --bot AW-1234ABCD
anchorweight investigate --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN" --bot AW-1234ABCD
```

## Operator policy

The CLI obtains the required CSRF session automatically.

```bash
anchorweight policy --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN" --bot AW-1234ABCD --allow
anchorweight policy --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN" --bot AW-1234ABCD --quarantine
anchorweight policy --url http://127.0.0.1:8080 --token "$AW_DASHBOARD_TOKEN" --bot AW-1234ABCD --clear
```

## Trap test

```bash
anchorweight trap-test --url http://127.0.0.1:8080
```

This command intentionally behaves like the recursive crawler AnchorWeight is designed to identify. Use it in Shadow Mode or from a source you are willing to quarantine.

## Backup, evidence, retention

```bash
anchorweight backup --profile production --dest ./backups
anchorweight report --profile production --out ./reports/evidence.json
anchorweight prune --profile production
```

Restore only while the service is stopped:

```bash
anchorweight restore --profile production --source ./backups/anchorweight-...
```

## v1 state upgrade

Inspect first:

```bash
anchorweight state-check --profile production
anchorweight migrate --profile production --dry-run
```

Then back up and migrate:

```bash
anchorweight backup --profile production --dest ./backups
anchorweight migrate --profile production
```

A real migration creates an additional `*.pre-v1-*.bak` state-file backup before writing the new schema.

## Final release gate

```bash
npm test
npm audit --audit-level=high
npm run release:check
anchorweight release-check --profile production
```

## SQLite storage (v1.2.0)

`AW_STATE_BACKEND=sqlite` opts into SQLite on Node 22.13+. The `backup`,
`report`, and `state-check` commands then inspect SQLite, rather than stale
legacy JSON. Back up before switching; stop AnchorWeight before restore.
`migrate` remains the JSON schema-migration tool. See [SQLITE-MIGRATION.md](SQLITE-MIGRATION.md).
