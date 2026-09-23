# AnchorWeight v1.8.0 — Gateway Protection & Reliability

## What the release does

Independent, **opt-in** access control, rate limiting, origin health and maintenance responses.
All gateway access/rate decisions apply **only to requests reaching the normal proxy route**.
The admin dashboard, setup wizard, operational endpoints and signed traps are excluded.
Bot DNA scoring, explicit Bot DNA policy, crawler evidence and distributed reporting are unchanged.
Neither these controls nor Node.js on shared hosting protects against network-layer DDoS traffic.
No runtime npm packages or JSON/SQLite schema migration are required.

## Safe HawkHost/cPanel upgrade

1. Stop your existing v1.7.0 app in Setup Node.js App. Preserve a private backup of `.git`, `.env`, `data/`, runtime files, and cPanel-managed environment variables.
2. Overlay the **contents** of the v1.8.0 source folder on the existing checkout. Do not delete existing state, Git history or cPanel Passenger config.
3. Use Node 22 in cPanel. Run `node --test --test-concurrency=1` and `npm run release:check`.
4. Leave ALL `AW_GATEWAY_*_ENABLED=false` and `AW_GATEWAY_SHADOW_MODE=true` during the first restart. Retain the existing `AW_SECRET`, dashboard token, setup configuration, source and backend.
5. Start the same Node app; verify `/live` is v1.8.0 and dashboard, historical evidence, and `/setup.html` load.
6. Configure optional controls **only after** verifying proxy traffic actually passes through AnchorWeight; restart via cPanel after environment changes.

## Configuration reference

```env
AW_GATEWAY_ACCESS_ENABLED=false
AW_GATEWAY_RATE_ENABLED=false
AW_GATEWAY_SHADOW_MODE=true
AW_GATEWAY_ALLOW_IPS=192.0.2.4,2001:db8:1::/64
AW_GATEWAY_DENY_IPS=198.51.100.0/24
AW_GATEWAY_RATE_PER_MINUTE=120
AW_GATEWAY_RATE_PATHS=[{"path":"/api/login","perMinute":10}]
AW_GATEWAY_HEALTH_ENABLED=false
AW_GATEWAY_HEALTH_INTERVAL_MS=30000
AW_GATEWAY_HEALTH_TIMEOUT_MS=2000
AW_GATEWAY_MAINTENANCE_ENABLED=false
AW_GATEWAY_MAINTENANCE_TITLE=Service temporarily unavailable
AW_GATEWAY_MAINTENANCE_MESSAGE=Please try again shortly.
```

- For direct connections, `req.socket.remoteAddress` identifies the client. With `AW_TRUST_PROXY=true`, the first `X-Forwarded-For` entry is used: configure it only behind a trusted edge which **overwrites client-supplied forwarding headers** and restricts direct access to AnchorWeight. Shared IPs/NAT may include many unrelated users.
- Deny entries take precedence over allow entries. Allow entries bypass only rate limiting; they do not bypass Bot DNA policies. IPv4-mapped IPv6 addresses normalize to IPv4.
- Path rules match an exact path or slash-segment child, longest match first. They do not parse query strings. Up to 16 paths and 128 allow/deny entries per list.
- In gateway shadow mode, would-deny/would-limit counters increase but requests continue. To enforce, change `AW_GATEWAY_SHADOW_MODE=false` deliberately after monitoring; this switch is independent of `AW_SHADOW_MODE` for crawler enforcement.
- A default per-IP fixed one-minute window applies when rate limits are enabled. Per-process counters reset on restart; they are not a globally shared limit across instances. A bounded client map can drop rate observations under saturation rather than incorrectly block new visitors.
- Gateway-denied responses are 403; rate-limit responses are 429 with `Retry-After`. Neither is proof of malicious crawling.
- An optional active HEAD probe checks only the current approved origin while proxy mode is active. HEAD support and 5xx have limitations: a 405 HEAD response can still show a reachable upstream, while a 503 indicates it is unhealthy. The probe is advisory and does not automatically route traffic elsewhere.
- `AW_GATEWAY_MAINTENANCE_ENABLED=true` enables a configurable, safely HTML-escaped HTTP **503** HTML/JSON maintenance response only for GET/HEAD proxy **transport errors before headers**. Upstream-generated 5xx pass through; state-changing requests retain the existing 502 on transport errors. No automatic retries, origin switching, or arbitrary browser-edited URLs are introduced.
- Maintenance responses are not substituted for existing partial responses. Data loss and outages can still occur.
- Logs and dashboard counters never need raw IPs; the in-memory rate counter uses keyed identifiers. No rate-limit state is written to JSON/SQLite.

## Rollback

Stop the app, restore the v1.7.0 source backup, and preserve your latest `data/` unless you explicitly intend to discard new evidence. Disabling `AW_GATEWAY_ACCESS_ENABLED`, `AW_GATEWAY_RATE_ENABLED`, `AW_GATEWAY_HEALTH_ENABLED`, and `AW_GATEWAY_MAINTENANCE_ENABLED` restores baseline v1.7.0 gateway behavior without changing existing crawler policies. Keep `AW_SECRET` stable.
