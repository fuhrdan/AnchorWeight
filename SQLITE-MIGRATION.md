# AnchorWeight v1.2.0: SQLite opt-in and rollback

SQLite is an **opt-in, single-process** persistence backend for v1.2.0. The
existing JSON backend remains the default and works on the existing Node.js
20/22/24 compatibility matrix. SQLite uses `node:sqlite` (Node.js 22.13+;
validated on Node 22.16 in this build). Node may display an experimental-module
warning. Do not enable SQLite on Node 20 or on a host that disables `node:sqlite`.

SQLite improves the cost of storing a changed profile/campaign/ban because it
writes a changed row rather than rewriting the entire JSON snapshot. The
in-memory data model and detection logic remain unchanged. This is **not yet a
multi-process/distributed state store**. Run only one instance against each
SQLite file; do not run two AnchorWeight workers pointing to the same file.

## Before changing your live site

1. Keep Shadow Mode enabled during validation.
2. Save your `AW_SECRET`, `AW_DASHBOARD_TOKEN`, configuration, and JSON state.
3. Run `npm test` and `npm run release:check` on the extracted release.
4. Stop the running AnchorWeight process before switching storage backends.
5. Back up the existing state with `node bin/anchorweight.js backup --dest ./backups`.

## Enable SQLite

In your cPanel Node.js 22.13+ app environment (or `.env` if a separate loader is
in use), keep the existing `AW_STATE_FILE` and add:

```text
AW_STATE_BACKEND=sqlite
AW_STATE_FILE=./data/anchorweight-state.json
AW_SQLITE_FILE=./data/anchorweight-state.sqlite
```

On first start, if the SQLite file does not exist, AnchorWeight validates and
imports the JSON file as one transaction, then retains the JSON file unchanged.
If JSON is corrupt, unsupported, or has an unsupported future schema, startup
fails instead of starting with empty protection state. When an initialized
SQLite file already exists, it takes precedence over the legacy JSON file.
Do not delete the SQLite file to "retry" while production traffic is live.

Start the service and inspect `/ready` (`stateBackend: "sqlite"`), then run:

```bash
node bin/anchorweight.js state-check
node bin/anchorweight.js backup --dest ./backups
node bin/anchorweight.js report --out ./reports/anchorweight-evidence.json
```

Backups use SQLite's live backup API, not a raw copy of a WAL-mode file. A backup
may include the unchanged legacy JSON alongside the SQLite snapshot. The `migrate`
CLI subcommand still operates on JSON files; first-start import handles JSON to
SQLite migration automatically.

## Rollback

1. Stop the service. Preserve the new SQLite file before making changes.
2. Set `AW_STATE_BACKEND=json` and keep the original `AW_STATE_FILE` path.
3. Restart in Shadow Mode; inspect `/ready`, campaign counts, and policies.

**Important:** The JSON rollback copy is a snapshot of state **before SQLite was
enabled**. Later SQLite-only changes will not be present in it. To preserve
those changes, restore a SQLite backup instead of switching to JSON.

For restoring a saved SQLite backup, stop AnchorWeight first, keep the same
`AW_STATE_BACKEND=sqlite` configuration, then run:

```bash
node bin/anchorweight.js restore --source ./backups/anchorweight-...
```

Do not restore a database while the service is running. The restore command
replaces the SQLite file and removes its older `-wal` / `-shm` sidecars; doing
this to a live process can lose data. Backup data may contain derived identities
and security evidence: protect its filesystem permissions and access.

## Performance validation

With a local instance running, compare equal traffic and hardware on JSON
and SQLite in **separate test directories**:

```bash
npm run benchmark -- http://127.0.0.1:8080/health 500 10
```

The benchmark prints throughput, p50/p95/p99 request latency, and error counts.
`/health` is only a server baseline; repeat using your own representative,
authorized test traffic through the proxy for a true application comparison.
Do not use this tool to load-test someone else's site.
