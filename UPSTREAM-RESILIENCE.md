# AnchorWeight v2.3.0: Circuit Breakers & Upstream Resilience

## First install: no routing changes

v2.3 is **opt-in**. Install it with `AW_RESILIENCE_ENABLED=false` in cPanel. Keep your existing
`AW_PROXY_ENABLED`, `AW_ORIGIN_URL`, data files, `AW_DECLARATIVE_ENABLED`, database and Bot DNA
settings unchanged. No new npm packages, runtime services or data migrations are required.

After backing up v2.2 and stopping the app, overlay the release **contents** (not a nested folder),
activate Node 22 and run `node --test --test-concurrency=1` and `npm run release:verify` before
restarting in cPanel. Verify `/live`, `/ready`, dashboard, wizard, existing site paths and evidence.
Do **not** switch gateway protection or origins during the version upgrade.

## Enable circuit breakers without a fallback

```env
AW_RESILIENCE_ENABLED=true
AW_RESILIENCE_FAILURE_THRESHOLD=3
AW_RESILIENCE_COOLDOWN_MS=30000
AW_RESILIENCE_HEALTH_ENABLED=false
```

An origin's circuit opens after three consecutive HTTP 5xx responses or transport errors. Its
open circuit rejects **new** requests with HTTP 503. After the cooldown, one bodyless GET/HEAD
may pass as a half-open probe; an HTTP status under 500 closes the circuit. This is deliberately
process-local and restarts with no stale failures. Existing upstream HTTP 5xx responses pass
through unchanged; never retry a request that has already started.

A `503` maintenance response on a breaker-open path is separate from the older
`AW_GATEWAY_MAINTENANCE_ENABLED` transport-failure page; the configured maintenance title and
message are reused and safely HTML-escaped. `Retry-After: 30` is advisory, not a guarantee.

## Optional approved fallback destinations

Fallbacks must be functionally equivalent to the primary for read-only requests. Verify their
application compatibility, state, authorization behavior, data locality and exposure **before**
enabling them. The private fallback file is a small JSON document, not a URL received from users:

`./data/anchorweight-fallbacks.json` (create with file mode `0600`):

```json
{
  "version": 1,
  "fallbacks": [
    { "origin": "http://127.0.0.1:8081/", "fallback": "http://127.0.0.1:8082/" }
  ]
}
```

Configure in cPanel (replace the example addresses with your **actual** origins):

```env
AW_RESILIENCE_ENABLED=true
AW_RESILIENCE_FALLBACKS_FILE=./data/anchorweight-fallbacks.json
AW_RESILIENCE_ALLOWED_ORIGINS=http://127.0.0.1:8082/
AW_SETUP_PUBLIC_HOST=aw.example.com
```

The exact primary must be an existing configured default or route origin. The exact fallback
must be on the cPanel allowlist, must not be any configured primary, and must not be the public
AnchorWeight host. The file must live inside `./data/`, have `.json` extension, use 0600 Unix
permissions, and cannot be a symlink where `O_NOFOLLOW` is available. Invalid enabled settings
abort startup rather than silently redirecting customer traffic. Max 16 mappings, 32 allowed
fallback entries and a 16-KiB file.

**When the primary's circuit is open**, only a **new bodyless GET or HEAD** uses the approved
fallback. POST/PUT/PATCH/DELETE never go to an alternate origin. Requests already sent to a
primary are **never replayed** if that origin fails. Existing HTTP 5xx responses are never
replaced by fallback content. The fallback receives the request path and query unchanged, but
`Authorization` and `X-API-Key` are removed before forwarding to a different origin. This may
make an authenticated application endpoint unavailable on the fallback: arrange the fallback's
own service-level authentication separately. An absent/unhealthy fallback returns 503.

## Per-origin periodic HEAD monitoring (optional)

```env
AW_RESILIENCE_HEALTH_ENABLED=true
AW_RESILIENCE_HEALTH_INTERVAL_MS=30000
AW_RESILIENCE_HEALTH_TIMEOUT_MS=2000
```

Every configured primary and fallback gets its own HEAD probe at `/`; at most two run at once.
HTTP statuses under 500 count as healthy; transport errors and 5xx count as failures. HEAD must
be supported by your upstream's root URL; otherwise leave probes off and let real traffic
change the breaker state. A probe is **not** proof that every route or database is healthy.
The prior default-origin `AW_GATEWAY_HEALTH_ENABLED` monitor remains separate; you can leave
that feature off when using the new per-origin probes. All timers are unref'ed and stopped on
shutdown. No cross-process coordination or persistent circuit states are promised.

## Operator UI and rollback

The authenticated dashboard shows circuit state, per-path failure counts and configured
fallback counts; it does not expose origin URLs or credentials. `/ready` retains its strict
origin checks and may report 503 even while an approved fallback serves read-only requests.

Rollback protection immediately without touching data or changing origins:

```env
AW_RESILIENCE_ENABLED=false
AW_RESILIENCE_HEALTH_ENABLED=false
```

Restart the cPanel app. To roll back code, stop the app and restore the **source files** from
your pre-v2.3 backup. Do not restore old `data/` over newer evidence unless specifically
recovering data. Keep dashboard, trap and health routes local; do not enable `AW_TRUST_PROXY`
unless the trusted TLS terminator overwrites forwarded headers.
