# AnchorWeight v1.7.0 — Operator Setup Wizard & Traffic Telemetry

## Release scope and compatibility

This release adds an authenticated setup workflow and bounded in-memory edge
telemetry without changing state schema v5. JSON and SQLite deployments retain
their existing evidence, operator reviews and policies. The cPanel-compatible
`app.js` startup remains free of top-level await. No new npm runtime packages,
.NET services or mandatory proxy configuration are introduced.

The existing dashboard remains at `/dashboard.html`. The wizard is at
`/setup.html`, including when the reverse proxy is disabled. The setup page
itself can be loaded without credentials, like the dashboard, but its read,
validate and apply APIs require the dashboard bearer token. Applying changes
also requires the existing client-bound CSRF token and an authenticated admin
rate limit. The UI does not accept or return `AW_SECRET`, database credentials,
hub secrets or arbitrary environment variables.

## Safe HawkHost/cPanel upgrade

1. Stop the existing Node app in Setup Node.js App, and privately back up the
   application including `.env` and `data/`.
2. Overlay the CONTENTS of this source folder over the existing Git checkout.
   Preserve `.git`, `.env`, the entire live `data/` directory and cPanel's
   generated Passenger configuration. Do not recreate the cPanel app.
3. Activate its existing Node 22 environment and run:

   ```bash
   node --test --test-concurrency=1
   npm run release:check
   ```

4. Initially leave `AW_SETUP_CONFIG_ENABLED=false` and
   `AW_SETUP_WRITES_ENABLED=false`. Keep `AW_PROXY_ENABLED`, `AW_ORIGIN_URL`,
   `AW_SECRET`, `AW_DASHBOARD_TOKEN` and `AW_SHADOW_MODE` unchanged.
5. Start the app, verify `/live` reports `1.7.0`, `/ready` and dashboard work,
   existing profiles still appear, `/setup.html` loads, and traffic telemetry
   updates when using the dashboard. A disabled proxy will still count requests
   to AnchorWeight itself; those are NOT protected-origin requests.

## Enabling browser configuration explicitly

After you have verified the update, set the following **in cPanel** and restart:

```env
AW_SETUP_CONFIG_ENABLED=true
AW_SETUP_WRITES_ENABLED=true
AW_SETUP_PUBLIC_HOST=aw.newlands-games.com
AW_SETUP_ALLOWED_ORIGINS=http://127.0.0.1:8081,https://trusted-private-origin.example
```

Replace the origins with your *actual*, independently approved upstreams.
The initial `AW_ORIGIN_URL` configured in cPanel is automatically approved,
plus any additional origins in `AW_SETUP_ALLOWED_ORIGINS`. The public-host
setting rejects the matching origin host to help prevent a self-proxy loop;
configure this explicitly for your deployment. Do not use the public
`aw.newlands-games.com` address itself as its own origin. Only HTTP/HTTPS root
origins without credentials, query strings, fragments or extra paths are
accepted. The exact normalized origin must be on the approved list. Only the
cPanel administrator can expand that list; the UI cannot create destinations.

At `/setup.html`, authenticate using your existing dashboard token, review
status, select an approved origin, select whether to enable the proxy, then
validate and explicitly apply. Validation makes a 2-second HEAD request to the
**approved** origin and reports the HTTP status; a non-2xx response can still
prove the server responds, while 5xx indicates unhealthy origin. Validation
never activates or saves anything. Applying prepares the new reverse proxy,
atomically writes `data/anchorweight-operator.json` with file permissions
0600, and swaps the running proxy. Future restarts read this file only when
`AW_SETUP_CONFIG_ENABLED=true`. The saved file overrides only `originUrl` and
`proxyEnabled`; all credentials, state paths, federation settings and
Shadow/Enforce Mode remain in cPanel.

If the file is missing or invalid, AnchorWeight warns and falls back to the
original cPanel values. Disabling `AW_SETUP_WRITES_ENABLED` makes the wizard
read-only without undoing saved routing. Disable
`AW_SETUP_CONFIG_ENABLED` and restart to ignore the saved file entirely.

**Do not confuse enabling a reverse proxy with protecting your actual site.**
Site DNS/front-proxy routing must send the protected site's requests through
AnchorWeight, and its origin must not be publicly bypassable, if you rely on
Silent Quarantine. Test this with a separate origin/host before switching a
production domain. The wizard does not manipulate DNS, cPanel domains, TLS
certificates or protected-origin firewall controls.

**Security limitations:** Only destinations explicitly trusted by the cPanel
administrator may be probed or proxied. DNS configuration for those destinations
remains the operator's responsibility. Do not approve attacker-controlled
names: this release does not implement DNS pinning or prevent rebinding by a
malicious operator-approved domain. Never treat a 200 HEAD response as proof
that a website is correctly configured end-to-end.

## Telemetry semantics

Authenticated stats at `${AW_BASE_PATH}/api/stats` (normally `/anchor/api/stats`)
include a `telemetry` object. The dashboard shows:

- Lifetime request and proxied-request counts since process start.
- In-process current active responses and active upstream request streams.
- HTTP final status classes (2xx, 3xx, 4xx, 5xx, other) for all requests that
  reach the Node application.
- Mean total request response duration and mean upstream time **to first
  response headers** (not full body transfer time).
- Upstream failures and 12 five-minute traffic buckets over the past hour.

There are no raw IP addresses, URLs, cookies, user agents or tokens in the
telemetry data, and no persistent telemetry database. Counters reset on restart
and are not aggregated across multiple Node processes or other machines.
Heavy network-layer traffic that never reaches the Node process is outside
these metrics. This is observability, not DDoS protection, upstream failover,
a general IP firewall or multi-origin routing (planned for later releases).

## API summary

- `GET /anchor/api/setup` — authenticated, redacted configuration status.
- `POST /anchor/api/setup/validate` — authenticated and CSRF-protected; strict
  key/type/origin validation and bounded active origin HEAD probe.
- `POST /anchor/api/setup/apply` — same protections, additionally requires
  `AW_SETUP_CONFIG_ENABLED=true` and `AW_SETUP_WRITES_ENABLED=true`.

POST body has exactly two keys:

```json
{"proxyEnabled":false,"originUrl":"http://127.0.0.1:8081/"}
```

No arbitrary environment variables, routes, domains, tokens or secrets may be
changed via this API. `AW_SCORE_ENFORCEMENT_ENABLED` and `AW_SHADOW_MODE` remain
independent. Requests are capped at 8 KB or the lower configured admin limit.

## Rollback

Stop the app and restore the v1.6.0 source from your private backup, preserving
up-to-date state and logs unless you *intentionally* want to discard evidence.
The old source ignores the optional operator settings file. If you stay on
v1.7.0 but need to recover the original cPanel proxy settings, disable
`AW_SETUP_CONFIG_ENABLED` and restart; the private file remains available for
inspection. Keep your existing `AW_SECRET` and dashboard token unchanged.
