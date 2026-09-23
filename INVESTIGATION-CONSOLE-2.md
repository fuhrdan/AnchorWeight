# AnchorWeight v1.5.0 — Investigation Console 2.0

## Purpose

This release improves inspection and reporting. It **does not change detection thresholds,
quarantine policy, the persistence schema (still v5), network trust settings, or proxy behavior**.
It retains the v1.2 cPanel `async main()` startup fix and the existing JSON/SQLite backends.

## Dashboard

Open `/dashboard.html`, enter your existing `AW_DASHBOARD_TOKEN`, and use **Events** to
filter by Bot DNA ID, event type, text, or UTC-normalized time window. Use **Investigate**
to open a Bot DNA ID such as `AW-ABCDEF12` or a campaign ID such as `AWC-1234ABCD`.
Cases show a chronological timeline, evidence context and documented relationships.
Timeline text and report exports are drawn from the *currently retained local event log*;
rotated/expired events are not included. The public timeline is capped at 200 events and
reads at most 500 recent matching events per identity. This is not an archive search.

## Review vs enforcement

The new review form stores `needs_review`, `false_positive`, `confirmed_automation` or
`inconclusive`, an optional note (up to 500 characters), and a timestamp in the existing
Bot DNA profile. The action requires bearer authentication **and CSRF**, and records a
separate audit event without duplicating the free-text note in the audit log.
A review is *not* a change in quarantine/allow policy. To make a change, use the existing
Allow / Quarantine / Clear policy controls explicitly.

## Authenticated API

All URLs below are relative to `AW_BASE_PATH` (default `/anchor`). For API access use
`Authorization: Bearer <dashboard-token>`; never put the token in a shared URL.

- `GET /api/investigate?bot=AW-ABCDEF12` — public profile, associated campaigns and events.
- `GET /api/investigate?campaign=AWC-1234ABCD` — campaign, observed members and events.
- `GET /api/report?bot=AW-ABCDEF12&format=json` — downloadable structured case report.
- `GET /api/report?campaign=AWC-1234ABCD&format=txt` — plain-text case report.
- `POST /api/review` — JSON `{ "botId": "AW-ABCDEF12", "status": "needs_review", "note": "optional" }`, plus `X-AW-CSRF` from `/api/session`.

Case queries accept `from`, `to` (parseable ISO date/time strings), `type`, `q` and `limit`
(1–200). Exports honor the same filters as the displayed case in the dashboard. Events
and exports use public Bot DNA identifiers and redact signed canary URL segments and
unknown log fields. Exports are sensitive administrative evidence and should be stored
privately. JSON and plain text are the supported report formats; this build does **not**
include server-side PDF rendering.

## Upgrade from v1.4.0 on HawkHost/cPanel

1. Stop the Node.js app. Back up the **complete** installation, private `.env`, `data/`,
   JSON or SQLite state and event/audit logs. Preserve the old `AW_SECRET` and token.
2. Extract the source ZIP to a temporary folder. Overlay the ZIP's *contents* into the
   existing application root; do **not** replace `.git/`, `.env`, or `data/`.
3. In the Node 22 virtual environment run `node --test --test-concurrency=1` and
   `npm run release:check` (shared hosting may exhaust threads with parallel tests).
4. Start the **existing** cPanel Node app. Check `/live` reports `1.5.0`, `/ready`,
   `/dashboard.html`, a historical Bot DNA profile and a JSON report. Leave Shadow Mode on
   while validating. No migration command or new npm runtime dependency is required.
5. Only after confirming it works: stage source/docs/tests, review for secrets, commit,
   push `main` and push the `v1.5.0` tag.

**Rollback:** Stop the app; restore the v1.4.0 backup and its configuration/data.
Reviews written after the v1.5.0 backup will be absent from that backup. Never overwrite a
live SQLite WAL file; use a clean database backup while the service is stopped.
