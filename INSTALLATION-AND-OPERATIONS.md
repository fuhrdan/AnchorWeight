# AnchorWeight v2.6.0: first installation and daily operation

This guide is for humans operating AnchorWeight on cPanel/HawkHost or a local
Node.js server. **No npm runtime dependencies, database migration, or automatic
routing changes were added in v2.6.0.** The v2.5 alerts, v2.4 observatory,
v2.3 resilience and v2.2 app auth retain their previous opt-in settings.

## New operator commands

| Command | Effect |
| --- | --- |
| `npm run setup` | Interactive terminal-only installation plan (TTY); displays two new random secrets once. Nothing is written. |
| `npm run setup -- --mode trap` | Noninteractive trap-only plan (no secrets printed). |
| `npm run setup -- --mode proxy --origin http://127.0.0.1:8081/` | Noninteractive origin plan; rejects non-HTTP(S), credentials, fragments and paths. |
| `npm run doctor` | Read-only local environment, configuration, private policy, state and path checks. |
| `npm run doctor -- --json` | Machine-readable result. |
| `npm run doctor -- --probe` | Additionally sends a bounded HEAD to the configured default origin. |
| `npm run config:export -- --format yaml` | Print gateway-only config; JSON is default. |
| `npm run config:export -- --out ./gateway-export.json` | Save new export with `0600` permissions; refuses overwrite. |
| `npm run config:import -- --from ./gateway-export.json` | Validate proposed private gateway config; **does not write**. |
| `npm run config:import -- --from ./gateway-export.json --apply --confirm-stopped` | Atomically install validated config for next restart, retaining `.previous`. |
| `npm run config:rollback -- --apply --confirm-stopped` | Revalidate previous config against **current** allowlists and restore on next restart. |

### 1. New HawkHost/cPanel installation

1. Upload the extracted ZIP to a private app directory, e.g.
   `/home/ACCOUNT/anchorweight/AnchorWeight` (not the public web root).
2. In **cPanel > Setup Node.js App**, choose Node.js 22; create the app with
   startup file **`app.js`**, its selected app URL/domain and its existing app root.
   Do not create a new app when upgrading an existing one.
3. Activate the Node 22 environment shown by cPanel; `node --version` must
   show the selected version. Run `npm run setup` interactively. Copy the two
   printed secrets privately into cPanel environment variables, not `.env` in Git.
   Alternatively generate secure secrets yourself in cPanel.
4. Initially use `AW_PROXY_ENABLED=false`, `AW_SHADOW_MODE=true`,
   `AW_APP_AUTH_ENABLED=false`, `AW_ALERTS_ENABLED=false`, and
   `AW_RESILIENCE_ENABLED=false`. Keep existing settings on upgrades.
5. Run `npm run doctor`. First-run WARN for a not-yet-created data directory
   is expected. Fix FAIL entries. Doctor never creates folders or changes data.
6. Run `node --test --test-concurrency=1` and `npm run release:verify`.
   The former avoids small cPanel process/thread quotas; verification checks
   source SHA-256 checksums without rewriting them.
7. Start/restart the existing app in cPanel, visit `/live`, `/ready`,
   `/dashboard.html` and `/setup.html`. The dashboard's authenticated API needs
   the dashboard token. Verify historical evidence after an upgrade.
8. For proxy deployment, approve the **private** origin and put the public
   site's traffic through AnchorWeight. Lock down direct public access to the
   private origin. Enable advanced controls one by one after testing.

**Common HTTP 503 diagnostic:** cPanel may still be running the old process or
startup may have failed on an enabled private policy. Stop app in cPanel and
run `timeout 10s node app.js` from the correct app root using the cPanel Node
virtualenv; inspect its error, then restart. Do not rotate secrets, delete
`data/`, or regenerate `SOURCE-MANIFEST.json` as a troubleshooting shortcut.

### 2. Configuration ownership and safe import/export

The local export includes ONLY `{version, proxy:{enabled,defaultOrigin}, routes}`.
It never includes cookies, keys, dashboard credentials, auth hashes, crawler
state, logs, or evidence. Even an export can reveal private origin addresses:
store it privately and review before sharing.

When declarative mode is **off**, export reflects the active legacy gateway
settings, including an optional operator file or private route file. When
**on**, it reflects the validated declarative file. If an enabled file is
missing or invalid, export/doctor reports the error instead of making up defaults.

To import, FIRST configure the destination in cPanel:

```env
AW_DECLARATIVE_ENABLED=true
AW_DECLARATIVE_FILE=./data/anchorweight-gateway.json
AW_SETUP_PUBLIC_HOST=your-anchorweight-host.example
AW_SETUP_ALLOWED_ORIGINS=http://127.0.0.1:8081/
AW_ROUTE_ALLOWED_ORIGINS=http://127.0.0.1:3001/
AW_ROUTES_ENABLED=false
AW_SETUP_CONFIG_ENABLED=false
```

Add each real approved route origin before importing. These are examples only;
do not paste a different site's origin into production. The target file must
reside in private `data/` and use `.json`, `.yaml` or `.yml`. A stopped-app
import is *not* live reconfiguration: restart in cPanel to load it. The browser
Setup Wizard remains a separate, authenticated route-editing workflow.

```bash
# 1. Preview gateway-only config, no write and no secrets.
npm run config:export -- --out ./private-gateway-backup.json

# 2. Validate under the destination's CURRENT allowlists.
npm run config:import -- --from ./private-gateway-backup.json

# 3. Stop the cPanel app and back up its entire private directory.
# 4. Commit the validated file (only after confirming app is stopped).
npm run config:import -- --from ./private-gateway-backup.json --apply --confirm-stopped

# 5. Restart, check /live /ready dashboard and normal origin paths.
# If the new routing is unsuitable, stop the app, then:
npm run config:rollback -- --apply --confirm-stopped
# Restart again and verify.
```

The immediately previous private gateway file is kept as `.previous` when a
file was replaced. First installation has no previous file; use the full app
backup. Import/rollback reject symlinks where supported, empty/oversized files,
invalid YAML, unknown document fields, unapproved origins and protected-path
routes. Only one prior file is retained: keep separate full backups for longer
history. **An import does not write cPanel environment variables**, and secret
and enforcement policy remain outside this transfer format.

If you use `AW_DECLARATIVE_ENABLED=false`, you can export but you cannot apply a
declarative import. Legacy writable operator or route modes cannot be mixed with
active declarative mode. Doctor explains these failures rather than changing
production settings silently.

### 3. Routine operating checklist

Run `npm run doctor` before and after significant cPanel configuration changes;
check `/live`, `/ready`, the dashboard, existing evidence and a representative
normal proxied route. Use `npm run release:verify` after source deployments.
Back up the application before every upgrade. Keep `data/`, backups and cPanel
credentials out of Git. Stop the app before restoring a SQLite backup. Leave
Shadow Mode on until evidence justifies enforcement. Optional alert webhooks
are best effort, and live metrics reset on restart.

### 4. What the doctor can and cannot prove

Doctor checks Node version, effective config schema, persistent secret and
admin-token presence, path writability, enabled private policy file validity,
and persisted state compatibility. It reports PASS/WARN/FAIL/SKIP and exits
nonzero for FAIL. It does not make directories, start the app, edit files, run
external commands, or perform network probes unless `--probe` was requested.
A passing doctor does **not** prove a public domain has working TLS, that
cPanel forwards WebSocket upgrades, or that a private origin cannot be reached
outside the proxy. Check those on the actual deployment.
