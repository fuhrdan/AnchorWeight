# AnchorWeight Security Notes — v1.2.0

AnchorWeight is a proof of concept. Deploy it conservatively and begin in Shadow Mode.

## Defensive intent

AnchorWeight is designed to identify recursive automated crawling and protect the owner's own web origin by diverting convicted clients to bounded decoy responses. It does not send massive files, hold connections indefinitely, or generate unbounded server-side work.

## Good-bot verification

A User-Agent is never sufficient evidence of crawler identity. v1.2.0 verifies supported Google and Bing claims using:

1. Reverse DNS on the request source IP.
2. Validation that the PTR hostname ends in an approved provider suffix.
3. Forward DNS of that hostname.
4. Confirmation that the original source IP is among the forward results.

DNS failure means **not verified**, not automatically malicious. A failed claim adds a configurable risk signal because an explicit provider claim did not validate.

## Trusted proxy warning

Only set `AW_TRUST_PROXY=true` when AnchorWeight is behind a reverse proxy you control and that proxy overwrites `X-Forwarded-For`. Otherwise clients may spoof the address AnchorWeight fingerprints and verifies.

## Manual Bot DNA policies

`AW_ALLOW_BOT_IDS` and `AW_QUARANTINE_BOT_IDS` are operational overrides. Treat the dashboard token and environment configuration as administrative secrets. IDs are derived from the keyed IP fingerprint, so changing `AW_SECRET` changes Bot DNA IDs.

Explicit allow should be used sparingly. Explicit quarantine is still subject to Shadow Mode so a test deployment cannot unexpectedly isolate traffic.

## Origin bypass

Whole-site quarantine only works if the real origin cannot be reached directly. Bind the origin to loopback/private networking or restrict it at the firewall/reverse-proxy layer.

## False positives

Do not enable score enforcement immediately. Recommended rollout:

- Shadow Mode on.
- Proof-of-Crawl enforcement first.
- Review several days of traffic.
- Allowlist verified internal automation when needed.
- Enable score enforcement only after tuning.

## Resource limits

Decoys are intentionally small. AnchorWeight does not attempt to exhaust a crawler's bandwidth, CPU, memory, or connection pool.

## Privacy

Persistent Bot DNA is keyed from the configured secret. Normal dashboard data does not expose raw IP addresses or full User-Agent strings. Event logs in v1.2.0 also avoid writing raw User-Agent values for lure/traversal events.

## Reporting vulnerabilities

Do not include production secrets, raw visitor logs, or private origin credentials in a public issue. Reproduce with synthetic data when possible.


## CLI security notes

Avoid placing long-lived secrets directly on a shared shell command line because process listings and shell history may expose arguments. Prefer `AW_SECRET` and `AW_DASHBOARD_TOKEN` environment configuration for durable deployments. The `config` and `check` commands redact secrets when printing effective configuration. Use `trap-test` in Shadow Mode for normal verification; running it from an enforced client intentionally exercises the same conviction path as a crawler.


## v1.2.0 operator actions

The investigation API never returns the internal keyed IP fingerprint. Manual policy changes require the dashboard bearer token and accept only existing `AW-XXXXXXXX` Bot DNA IDs. Campaign correlation does not automatically expand quarantine to other campaign members. Protect the dashboard token as an administrative credential and do not expose the dashboard publicly without TLS and appropriate network controls.


## v1.2.0 operational security

Configuration profiles intentionally exclude secrets. Backups and exported evidence may contain behavioral security telemetry and should be access-controlled. Restore should be performed with the service stopped to avoid concurrent state writes. Log rotation is size-bounded and retention-bounded to reduce disk-exhaustion risk, but operators should still monitor filesystem utilization. `doctor` performs bounded network checks and does not modify enforcement state.

## v1.2.0 administrative hardening

Administrative APIs require a bearer token by default. Passing the dashboard token in a URL is disabled because URLs may leak through browser history, reverse-proxy logs, analytics, or referrer handling. `AW_ALLOW_QUERY_ADMIN_TOKEN=true` exists only for controlled compatibility scenarios and should not be used in normal production deployments.

Operator mutations require a short-lived CSRF token obtained from the authenticated `/api/session` endpoint and supplied as `X-AW-CSRF`. CSRF tokens are bound to a keyed client identity and expire.

The admin surface is rate-limited per keyed client identity. Administrative mutation bodies and proxied request bodies are bounded. Audit events use a keyed client identifier rather than raw source IPs.

`/live` indicates process liveness. `/ready` may include a bounded probe of the configured origin; disable that behavior with `AW_READINESS_ORIGIN_CHECK=false` if the origin must not receive readiness HEAD requests.

The Docker image runs as the unprivileged `node` user. systemd examples enable basic sandboxing. These are starting points, not substitutes for host-level firewalling and origin isolation.
