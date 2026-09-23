# AnchorWeight v1.6.0 — Distributed Intelligence Foundation

## What v1.6 actually does

The existing site application keeps enforcing LOCAL policy, and its existing
JSON/SQLite state schema (5) stays unchanged. By default there is no hub
connection and no outgoing network traffic. If opted in, it sends only locally
attested, allowlisted event summaries to a separately deployed hub: completed
signed-depth traversals, blackhole interactions, and local campaign correlations.

The hub groups evidence by registered site. IDs from independent installations
MUST NOT be compared as global identities. A local campaign correlation is NOT
proof that an independently observed client on a different site is controlled
by the same person. No cross-site bans, common-operator attribution, control
plane, or federated signed-canary verification is implemented in v1.6.

## 1 — Upgrade an existing site safely

Stop app, archive existing application including `.env` and `data/` (private),
then overlay the CONTENTS of `AnchorWeight-v1.6.0/` on the existing Git checkout.
Do not delete `.git`, `data`, local config, or change `AW_SECRET` or
`AW_DASHBOARD_TOKEN`. The release archive omits private runtime files.
Run `node --test --test-concurrency=1` and `npm run release:check` on HawkHost
using Node 22. Verify `/live` reports `1.6.0` and the dashboard loads.

**Leave `AW_INTELLIGENCE_ENABLED=false` until you have separately tested a hub.**
The normal sensor works without the hub, with no additional npm dependencies.

## 2 — Deploy a separate hub Node app (not the site app)

The hub startup is `hub.js` for cPanel (or `node bin/intelligence-hub.js`
on a VPS). On cPanel, configure a separate
Node.js application/URL and assign its own application root and Node 22 runtime.
Use HTTPS at the hosting proxy (never internet-facing plaintext HTTP). The hub
itself binds HTTP for the trusted fronting TLS proxy, the same model as the
existing cPanel site app.

Create `data/intelligence-sites.json` outside Git (mode 0600):

```json
{
  "site_one": "replace-with-independent-random-secret-at-least-32-characters",
  "site_two": "replace-with-different-random-secret-at-least-32-characters"
}
```

Hub environment (set separately in the hub's cPanel application):

```env
AW_HUB_SITES_FILE=./data/intelligence-sites.json
AW_HUB_STATE_FILE=./data/intelligence-events.jsonl
AW_HUB_ADMIN_TOKEN=independent-random-secret-of-32-plus-characters
```

Configure file permissions 0600. The hub stores a bounded 2000-event JSONL
pilot dataset, with a single writer/process; do not load-balance multiple hub
processes against one state file. Put access controls and rate limits in the
trusted fronting proxy and restrict who receives the hub admin token.

Check hub `/live` first. Read aggregated events with:

```bash
curl -H "Authorization: Bearer YOUR_HUB_ADMIN_TOKEN" \
  "https://hub.example/v1/events?limit=20"
```

Do not paste secrets into shell history on shared machines.

## 3 — Enable a site sensor (only after hub is operational)

On `aw.newlands-games.com` (or another protected instance) configure:

```env
AW_INTELLIGENCE_ENABLED=true
AW_INTELLIGENCE_SITE_ID=site_one
AW_INTELLIGENCE_SITE_SECRET=the-site-ones-independent-secret-from-hub-file
AW_INTELLIGENCE_HUB_URL=https://hub.example/v1/evidence
```

The sensor signs the exact JSON request body and a 5-minute timestamp +
128-bit nonce with HMAC-SHA256. The hub verifies signature in constant time,
rejects replayed nonce, and deduplicates site-qualified event IDs. The nonce cache is bounded (8192)
and may reject excessive intake until timestamps expire.
Sensor requests are asynchronous, bounded (256 queued items), retried with
backoff, and fail open for LOCAL detection. The queue is memory-only: crashes,
restarts and retention can lose untransmitted events. This is NOT guaranteed
zero-loss delivery. No raw IPs, private `ipKey`, signatures from local canary
URLs, `sid`, cookies or operator notes are sent.

## Rollback

Stop and restore the prior source; restore data ONLY if you explicitly intend
to roll back evidence and operator reviews. Disable `AW_INTELLIGENCE_ENABLED`
to stop sharing evidence without changing the sensor version. Removing a site
registration immediately stops new intake from that site. Rotate federation
secrets independently of `AW_SECRET` and dashboard credentials.
