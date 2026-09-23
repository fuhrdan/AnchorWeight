# AnchorWeight v1.9.0 — Multi-Origin Routing & Release Hardening

Multi-origin mode is **OFF** by default. This release does not require a state
migration, new npm dependencies, a .NET runtime, or replacing the current
cPanel application. All existing JSON/SQLite state, signed crawler evidence,
manual policies, dashboard tokens, and federation settings remain unchanged.

## Safe v1.8 -> v1.9 upgrade on HawkHost

1. Stop the existing application in **Setup Node.js App**, and archive its application
   folder including private `data/` and `.env` (keep the backup private). Save the
   cPanel-managed environment settings separately.
2. Extract `AnchorWeight-v1.9.0-source.zip` outside the running folder, then overlay
   the **contents** of `AnchorWeight-v1.9.0/` on the existing Git checkout. Do not
   remove `.git`, `.env`, `data/`, or custom deployment settings.
3. In the Node 22 virtual environment, run
   `node --test --test-concurrency=1` and `npm run release:check`.
4. Leave `AW_ROUTES_ENABLED=false`. Restart the same cPanel application and verify
   `/live` reports 1.9.0, `/ready` and the dashboard work, historical investigations
   are present, and the setup wizard loads.
5. Only after validating production, review the staged source changes, commit and
   push to GitHub, and tag `v1.9.0`. Never stage private data or secrets.

## Enabling optional multi-origin routes later

Place this file under the existing, Git-ignored `data/` directory with mode 0600:

`data/anchorweight-routes.json`

```json
{
  "version": 1,
  "routes": [
    { "path": "/api", "origin": "http://127.0.0.1:3001/" },
    { "path": "/assets", "origin": "http://127.0.0.1:3002/" }
  ]
}
```

In cPanel Node App environment, set only after these addresses have been tested:

```env
AW_ROUTES_ENABLED=true
AW_ROUTES_FILE=./data/anchorweight-routes.json
AW_ROUTE_ALLOWED_ORIGINS=http://127.0.0.1:3001/,http://127.0.0.1:3002/
AW_SETUP_PUBLIC_HOST=aw.newlands-games.com
```

Also enable the existing `AW_PROXY_ENABLED=true` **only when you deliberately
intend to route a website through AnchorWeight**. `AW_ORIGIN_URL` remains the
fallback for paths that do not match any route, and the wizard can still change
that fallback when configured. Routing definitions themselves are not writable
from the wizard and require a restart. There is no live route-file watcher.

**Origin safety:** all extra origins must be approved EXACT root HTTP(S) URLs;
credentials, origin URL path/query/fragment, unknown hosts, self-routing back to
`AW_SETUP_PUBLIC_HOST`, and malformed/duplicate/protected route prefixes are
rejected. `/anchor`, `/live`, `/ready`, the dashboard and wizard remain local.
The public hostname must be set before enabling routes. Upstream servers must
be independently trusted; the allowlist is not a network isolation mechanism.
Keep protected origins private from direct public access.

**Matching:** the longest segment-prefix wins. `/api` matches `/api` and
`/api/users`, but not `/apiculture`. Query strings and methods are preserved;
no prefix stripping or host-based routing occurs. Unmatched paths use
`AW_ORIGIN_URL`. Encoded slash/dot/backslash and ambiguous request targets are
rejected in route mode. The proxy constructs outbound URL hostnames from the
approved origin, never from the incoming request-target.

**Health:** `/ready` HEAD-probes the default origin AND each extra origin (at
its root). A route returning HTTP 5xx or an unreachable origin makes readiness
503. Root HEAD checks are advisory; they are not proof that an application's
other endpoints are healthy. The periodic upstream-health widget continues to
monitor ONLY the default origin. There is no automatic rerouting of failed POST
requests; existing maintenance responses remain GET/HEAD-only.

**Rollback:** Stop the service and set `AW_ROUTES_ENABLED=false`; restart to use
the original single-origin path without discarding evidence. To roll back the
entire source version, restore v1.8 code and retain your current `data/` folder;
only restore old state if you intentionally want to lose newer evidence.

**Boundaries:** fixed maximum 16 routes and 32 KiB route file; local-process
telemetry and rate limits; no distributed route synchronization, cross-site
identity inference, automatic failover, Kubernetes gateway, or network-layer
DDoS mitigation. v1.9 is the final feature-focused release before v2.0
validation, not a claim that external production testing is complete.
