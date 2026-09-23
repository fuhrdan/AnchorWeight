# AnchorWeight v1.4.0 — Canary and evidence operations

## Safe rollout on cPanel

1. Download a backup of the live application, `.env`/cPanel environment, JSON/SQLite state, and audit/event files. Keep `AW_SECRET` unchanged.
2. Stop the existing Node.js app before replacing the source. Preserve `data/`, `.env`, and cPanel Passenger files. Use `app.js` at the SAME application root and keep the v1.2 cPanel async-main startup fix.
3. Keep `AW_STATE_BACKEND` unchanged (`json` unless you have separately completed and verified a SQLite migration). No new state schema or npm dependencies are required.
4. Start in `AW_SHADOW_MODE=true`, confirm `/live` reports `1.4.0`, `/ready` and dashboard work, then visit `/anchor/` to inspect distinct branch links.
5. Use `node --test --test-concurrency=1` on process/thread-limited shared hosting. Run `npm run release:check` before committing source.

## Config

| Environment | Default | Meaning |
|---|---|---|
| `AW_CANARY_BRANCH_COUNT` | `7` | Number of displayed branches, bounded 2–12. |
| `AW_CANARY_VARIANTS_ENABLED` | `true` | Independently signs each branch. `false` restores v1.2-style shared URLs with `?view=`. |
| `AW_SESSION_TTL_MINUTES` | `30` | Existing sliding session expiration. A signed path alone does not bypass TTL. |
| `AW_SESSION_BIND_IP` | `true` | Existing cross-client signed-canary correlation; valid signed chains are now required before correlation. |

## Evidence and classification

Each authenticated `/anchor/api/investigate?bot=AW-XXXXXXXX` response contains a bounded `profile.evidence` array with opaque session IDs, detection kind, reason, branch and depth. JSONL `/anchor/api/events` reports `branchPath` on successful traversal/proof events. It does not include signed canary URLs, raw IPs, or secrets. `profile.offenseCount` increments only on an actual recorded offense, not on every request or duplicate event. Recent evidence is limited to 16 per profile and 12 returned by the public profile view; event files follow the existing retention settings.

Attribution limitations: a shared IP may represent unrelated people; a signed-canary match demonstrates possession of a signed path, **not** a verified real-world identity or proof of malicious intent. Session lineage is in memory and event logs; active lure sessions are not restored after restart. Evidence does not enable additional automatic blocking beyond configured pre-existing policy.

## Rollback

Stop the app and restore the backed-up v1.2 code, leaving the ORIGINAL `AW_SECRET` and state files in place. v1.3 does not bump the state schema; the added optional profile fields are ignored by older code. If switching from SQLite to JSON, use a verified export/backup: the old pre-SQLite JSON copy is not automatically synchronized.
