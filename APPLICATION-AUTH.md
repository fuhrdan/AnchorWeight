# AnchorWeight v2.2.0 — Application Authentication & Security Policies

Application authentication protects **proxied application URLs**, and is unrelated to
AnchorWeight's own dashboard bearer token or crawler evidence. It supports HTTP Basic
Auth for staging pages and high-entropy API keys for application APIs. It does not
create login accounts or sessions. All new functionality is **disabled by default**.
There are no new npm runtime dependencies and no JSON/SQLite state migration.

## Upgrade without changing traffic

Stop your Node.js app in cPanel, back up its working directory and cPanel variables,
overlay the source (preserving `.git`, `.env` and `data`), activate Node 22, then run:

```sh
node --test --test-concurrency=1
npm run release:verify
```

Restart and check `/live` (version 2.2.0), `/ready`, dashboard, wizard and existing
crawler evidence. Keep `AW_APP_AUTH_ENABLED=false` until you deliberately configure
and test policies. Do not push the private `data/` directory to GitHub.

## Start using Basic Auth and API keys

From the application root on your own server:

```sh
node bin/app-auth.js init
node bin/app-auth.js add-basic /staging alice
node bin/app-auth.js add-key /api/private integration
node bin/app-auth.js list
```

`add-basic` prompts for a password **without terminal echo** (12–256 printable ASCII bytes).
`add-key` prints a random API key **once**; immediately store it in your client's
secret manager. The file `data/anchorweight-app-auth.json` contains only scrypt
password verifiers and SHA-256 digests of 256-bit random API keys, never plaintext
passwords or API keys. File permissions must be 0600 (`chmod 600 data/anchorweight-app-auth.json`); `.previous` keeps a prior copy.
An operator can edit this file manually while AnchorWeight is stopped, but the
application validates every field and fails startup when enabled with a missing,
invalid, symlinked, or oversized file. Maximum 16 protected paths and 8
credentials per path. Policies use longest **segment-prefix** matching; `/api`
protects `/api` and `/api/v1`, but not `/apiary`.

Configure the existing environment settings in cPanel:

```env
AW_PUBLIC_SCHEME=https
AW_APP_AUTH_FILE=./data/anchorweight-app-auth.json
AW_APP_AUTH_ENABLED=true
```

Keep your previous `AW_PROXY_ENABLED` value until testing, and **do not** create a
public HTTP entry point: the external visitor connection must use HTTPS, even if
HawkHost forwards to your Node process over loopback HTTP. Ensure the backend
origins are not directly reachable by visitors who could bypass this proxy.

Restart the existing cPanel Node app after changing the file or environment.
The Setup Wizard does **not** edit or return auth secrets. Dashboard stats show
policy counts and challenge counters, never identities, verifiers or keys.

### Request examples

For a browser, open `/staging` over HTTPS and respond to the Basic prompt.
For an API client:

```sh
curl -H 'X-API-Key: <your-key-from-add-key>' https://your-public-host/api/private
```

Basic credentials and API keys are **removed before proxying** an authenticated
request to the origin, so the upstream application does not receive or need them.
If an upstream application needs its *own* Authorization header on the same path,
do not enable AnchorWeight Basic Auth for that path; use a separate route.

Missing or invalid credentials return HTTP 401 and no proxy request is made.
Basic routes include `WWW-Authenticate`, which triggers the usual browser login
prompt. Excess concurrent password-hash checks return HTTP 429 with Retry-After.
Auth applies **after** Bot DNA preflight and existing gateway IP/rate checks,
but before any upstream request. Dashboard, wizard, health and trap APIs remain
local and retain their own authentication rules. Unmatched paths are public.

## Paths, rate limits, and known limitations

Policy paths are exact or slash-segment prefixes and may include `/` to cover
ordinary application traffic; reserved AnchorWeight paths cannot be claimed.
Policies are read at startup and must be changed locally, not by an HTTP caller.
For per-path limits, continue using `AW_GATEWAY_RATE_PATHS` from v1.8. Its IP rules
and throttles are distinct from Basic/API-key verification and remain opt-in.

* No user-registration, OAuth, login form, identity management, JWT or per-user
  permissions in v2.2. This release gives **route-level protection**, not RBAC.
* No browser-based secret editor; the CLI keeps credentials off browser APIs.
* API-key revocation/rotation: stop the app, remove the credential's entry from
  the private JSON, add the replacement through the CLI, restart. Keep backups
  private; a `.previous` file may hold an older verifier (not the plaintext key).
* Rate limiting is per-process. Basic verification is asynchronous and capped at
  four concurrent scrypt operations to protect shared-host resources.
* Enable auth only after confirming your trusted HTTPS public edge and testing
  that protected origins are not directly reachable. If `AW_TRUST_PROXY` is
  enabled for other gateway controls, the trusted edge MUST overwrite
  `X-Forwarded-For` instead of passing visitor-controlled forwarding data.

## Rollback

To immediately restore prior unauthenticated proxy behavior, set
`AW_APP_AUTH_ENABLED=false` in cPanel and restart. This ignores the private file;
it does **not** delete user evidence or change Bot DNA policy. To restore a
previous policy, stop the app and replace the private JSON with its `.previous`
copy, restart and test; never commit either private file to GitHub.
