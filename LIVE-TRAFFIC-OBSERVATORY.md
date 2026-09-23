# AnchorWeight v2.4.0 — Live Traffic Observatory

## What it does

The existing dashboard's **Live Traffic Observatory** adds approximate p50/p95/p99
response latency, first-upstream-header percentiles, route-level request and status
counts, and sanitized transport-error reasons. Histograms, the last 50 response
events and the existing 60-minute buckets are **in memory and per Node process**.
A restart clears these counters. Historical crawler evidence in JSON/SQLite is
unchanged; no new database or npm runtime dependency is required.

**Only requests forwarded to a protected origin appear in route metrics and the
redacted event feed.** Existing `totalRequests` still includes AnchorWeight's own
operational endpoints. Route labels are validated configured prefixes such as
`/api`, or `(default)`; never full request paths, query strings, IPs, headers,
authentication credentials or upstream URLs. Error reasons are fixed categories
(e.g. `timeout`, `connection_refused`, `transport_error`). p50/p95/p99 values are
histogram bucket **upper bounds**, not exact measurements; values above 120 seconds
are reported in the overflow bucket. Route metrics have a bounded 17-entry cache;
when live configuration changes introduce more, the oldest route record is evicted.

## Upgrade safely on HawkHost

1. Back up the working v2.3.0 directory **and cPanel environment variables**;
   stop the existing Node application using cPanel.
2. Overlay the v2.4.0 source ZIP into the same app root. Retain `.git`, `.env`,
   private `data/`, state files, and the existing Node 22 virtual environment.
3. Leave `AW_OBSERVATORY_LIVE_ENABLED=false` initially. Nothing else needs to
   change. Run `node --test --test-concurrency=1`, then `npm run release:verify`.
4. Restart the existing app; check `/live` reports `2.4.0`, `/ready`, the dashboard,
   Setup Wizard, previous Bot DNA evidence, normal origin routing, and the new
   route metrics. Commit and tag only after these checks succeed.
5. To try live streaming, set `AW_OBSERVATORY_LIVE_ENABLED=true` in cPanel and
   restart. Authenticate to the dashboard and press **Connect live**. Click
   **Disconnect** to close the stream. If your HawkHost/Passenger/Apache routing
   does not forward HTTP `Upgrade: websocket`, the dashboard's normal Refresh and
   redacted snapshot still work. Do not change your site routing to make WS work.

## Authentication and limits

- The existing `AW_DASHBOARD_TOKEN` bearer authentication and admin rate limit
  guard access to `GET <AW_BASE_PATH>/api/observatory/ticket`.
- Tickets are 256-bit random strings, valid for 30 seconds and consumed once.
  The dashboard token itself is never added to a WebSocket URL. Tickets should
  still be treated as short-lived credentials; avoid logging query strings on
  your reverse proxy. Do not share screenshots showing tickets.
- The stream uses same-host, same-scheme browser `Origin` checking and is
  restricted to the exact `<AW_BASE_PATH>/api/observatory/live` route. Do not
  enable it on an unencrypted public site. Set `AW_PUBLIC_SCHEME=https` for
  an HTTPS deployment; use `http` only for local development.
- A process accepts up to 8 live subscribers and 64 outstanding tickets. Slow
  subscribers are disconnected rather than causing unbounded process buffering.
  Client messages cannot inject observatory events. Subscriptions are read-only.
- No private listener or exposed origin is added; existing protected app routes
  and application-authentication rules are untouched. Dashboard auth is separate
  from application Basic Auth and API keys.

## Diagnostics and rollback

If the **Connect live** control reports a WebSocket problem, check whether the
front-facing proxy supports WebSocket upgrades; leave the feature disabled until
that is resolved. Ordinary traffic observability continues to work over the
existing authenticated `/api/stats` endpoint without WebSockets.

If the upgrade itself fails, leave `AW_OBSERVATORY_LIVE_ENABLED=false`, inspect the
startup error, and restore the pre-upgrade **source files** from the backup while
preserving any newer `data/` evidence. Never blindly replace a live SQLite WAL
set with an old backup. Revert to v2.3.0 if needed. There is no data migration.
