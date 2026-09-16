# AnchorWeight v1.1.0 Operations Guide

## Configuration profiles

Profiles live in `config/profiles/<name>.json` and contain an `env` object. Select one with `--profile <name>` or `AW_PROFILE=<name>`. Existing process environment variables override profile values; explicit CLI flags override both for the launched process.

Included profiles:

- `shadow`: reverse proxy enabled, Proof-of-Crawl observed, score enforcement disabled.
- `production`: reverse proxy and silent quarantine enabled, conservative score enforcement still disabled by default.

Keep secrets such as `AW_SECRET` and `AW_DASHBOARD_TOKEN` outside profile files.

## Doctor

`anchorweight doctor` checks configuration validity, persistent secret presence, dashboard-token readiness, writable state/event paths, and origin reachability. Add `--url` and `--token` to verify a running AnchorWeight health endpoint and authenticated stats API.

Example:

```bash
AW_SECRET=... AW_DASHBOARD_TOKEN=... anchorweight doctor --profile shadow   --origin http://127.0.0.1:8081   --url http://127.0.0.1:8080   --token "$AW_DASHBOARD_TOKEN"
```

A failed check produces a non-zero exit status for automation.

## Evidence rotation and retention

`AW_EVENT_MAX_MB` controls when the active JSONL evidence log is renamed to a timestamped rotated file. `AW_EVENT_RETENTION_DAYS` controls cleanup of rotated logs. `anchorweight prune` applies date retention to the active JSONL file immediately.

Defaults:

```text
AW_EVENT_MAX_MB=50
AW_EVENT_RETENTION_DAYS=30
```

## Backup and restore

Create a timestamped backup directory:

```bash
anchorweight backup --profile production --dest ./backups
```

Each backup contains available state/evidence files plus `manifest.json`.

Restore only while the AnchorWeight process is stopped:

```bash
anchorweight restore --profile production --source ./backups/anchorweight-...
```

The restore writes to the state/log paths from the selected effective configuration.

## Evidence reports

```bash
anchorweight report --profile production --out ./reports/evidence.json
```

The report contains generation metadata, counts, and a bounded set of recent events. Treat reports as security evidence; restrict access appropriately.

## Recommended upgrade workflow

1. Back up the current deployment.
2. Install the new version.
3. Run `anchorweight check`.
4. Run `anchorweight doctor`.
5. Start in Shadow Mode.
6. Verify `/health`, dashboard access, origin proxying, and the trap test.
7. Review Bot DNA and campaign evidence.
8. Enable enforcement only after validation.

## Production process lifecycle

v1.1.0 handles `SIGTERM` and `SIGINT` by stopping new connections, flushing persistent state, waiting for active connections to close, and exiting within `AW_SHUTDOWN_GRACE_MS`.

Health semantics:

- `/live`: Node process is running.
- `/ready`: AnchorWeight is initialized and, when enabled, the configured origin passes a bounded reachability probe.
- `/health`: compatibility alias for `/live`.

Administrative actions are separately written to `AW_AUDIT_LOG_FILE` when `AW_AUDIT_ENABLED=true`.
