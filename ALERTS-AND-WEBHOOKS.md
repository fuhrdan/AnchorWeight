# AnchorWeight v2.5 — Webhook Alerts & Typed Extension Hooks

Alerting is optional and **off by default**. It never changes crawler scoring,
rate enforcement, routing, application authentication or origin failover.
It uses Node's built-in libraries (no additional runtime npm dependencies).

## First upgrade on HawkHost

1. Stop the app in cPanel and back up its whole directory and cPanel variables.
2. Overlay v2.5 source while preserving `.git`, `.env` and `data/`.
3. Keep `AW_ALERTS_ENABLED=false`. In Node 22 run
   `node --test --test-concurrency=1` and `npm run release:verify`.
4. Restart the existing app; `/live` must report `2.5.0`, dashboard and wizard
   must load, and prior evidence must remain available. Only then push/tag.

## Enable alerts deliberately (not during initial upgrade)

On HawkHost Terminal, in the app root:

```sh
node bin/alerts.js init
chmod 600 data/anchorweight-alerts.json
```

The command refuses to overwrite an existing policy. Edit the private file and
replace `alerts.example.com` with your *actual* HTTPS webhook hostname.

Set these cPanel application environment variables (keep secrets out of Git):

```env
AW_ALERTS_ENABLED=false
AW_ALERTS_FILE=./data/anchorweight-alerts.json
AW_ALERT_ALLOWED_HOSTS=actual-webhook-provider.example
AW_ALERT_SIGNING_KEY=<a persistent, independently generated secret of at least 32 characters>
```

Then run `node bin/alerts.js validate` and change `AW_ALERTS_ENABLED=true`
only after validation. Restart once, refresh the authenticated dashboard's
**Alerts & Webhooks** section, and test with a nonproduction origin.

`AW_ALERT_ALLOWED_HOSTS` is a comma-separated list of exact lowercase DNS
hostnames (up to eight destinations in the JSON policy). Use a provider's
actual destination domain, not a wildcard. Webhook URLs are never exposed by
`/api/stats`. `AW_ALERT_SIGNING_KEY` must remain stable across restarts and is
never written to the policy file, manifest, log or dashboard.

## Private JSON policy

[Example configuration](config/examples/alerts-basic.json):

```json
{
  "version": 1,
  "webhooks": [{"id":"ops","url":"https://alerts.example.com/anchorweight"}],
  "rules": [
    {"id":"errors","kind":"upstream_error","route":"/","threshold":1,"cooldownSeconds":300,"webhook":"ops"},
    {"id":"five_hundreds","kind":"high_5xx","route":"/api","threshold":5,"cooldownSeconds":300,"webhook":"ops"},
    {"id":"opened","kind":"circuit_open","route":"/","threshold":1,"cooldownSeconds":300,"webhook":"ops"},
    {"id":"recovered","kind":"circuit_recovered","route":"/","threshold":1,"cooldownSeconds":300,"webhook":"ops"}
  ]
}
```

Only configured route labels (`/api`, `/assets`, `(default)`) or `/` (all
routes) are eligible. `high_5xx` fires on a count of 5xx proxied responses
in the last five minutes, with one alert per rule's cooldown. It is a **count**,
not a percentage. `upstream_error` is a sanitized transport-error signal.
`circuit_open` and `circuit_recovered` require v2.3 resilience enabled and
a corresponding primary-origin state transition; health probing is optional.

**Events are structured, redacted and fixed-shape**:

```json
{"schema":1,"kind":"high_5xx","rule":"five_hundreds","route":"/api","observed":5,"at":"2026-09-23T12:00:00.000Z"}
```

No raw visitor IPs, upstream hostnames, request URLs, headers, or credentials
are included. The JSON body's HMAC-SHA256 is sent in
`X-AnchorWeight-Signature: sha256=<hex>`; your receiver should compare it in
constant time against the configured signing key. Generic HTTPS JSON webhooks
work with a custom endpoint; Slack/Discord incoming webhooks may require a
provider-specific adapter, which this release does **not** claim to supply.

## Delivery bounds and security

* Only exact approved HTTPS hosts on port 443; DNS is resolved for each
  attempt and the public IPv4 address is pinned to the TLS request.
  Private/reserved/loopback DNS targets, custom ports and redirects are rejected.
  IPv6-only destinations are not supported in this initial release.
* At most eight webhook destinations and 16 rules. A maximum of two in-flight
  deliveries; 64 combined queued/in-flight alert jobs; three-second request
  timeout; one bounded retry on failure (which can duplicate a delivery).
* The queue and cooldowns are **process-local and in-memory**. They reset on
  restart. They do not guarantee delivery. Use the receiver's own durable
  queue for operational paging that must not be lost.
* A bad enabled private file fails startup rather than silently disabling
  alerts. File must be under `data/`, ≤16 KiB, a regular nonsymlink file
  with 0600 permissions on Unix. The example remains under `config/examples/`
  and never contains an actual token.
* Typed `onAlert(event)` can be supplied by code embedding the alert module.
  It receives only the fixed redacted event and cannot supply arbitrary
  request-time JavaScript or destinations. Treat webhook configuration changes
  as restart-only, cPanel-controlled operations.

## Rollback and diagnostics

Set `AW_ALERTS_ENABLED=false` and restart. This restores previous request
handling without deleting the private alert configuration, changing any
existing state schema, or erasing crawler evidence. For startup failures, read
cPanel's error log for `Alert configuration ERROR`, `invalid_alert_file`,
`alerts_file_permissions_require_0600`, or a destination validation error.
After an unexpected 503, confirm app `/live` before changing database state.
