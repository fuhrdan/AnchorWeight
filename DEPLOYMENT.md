# AnchorWeight v1.2.0 Deployment

## Recommended topology

```text
public HTTPS -> Nginx/Apache/cPanel proxy -> AnchorWeight :8080 -> private origin :8081
```

The origin should not be directly reachable from the public Internet.

## 1. Configure

Copy `.env.example` values into your hosting environment. Generate a long random `AW_SECRET` and a separate `AW_DASHBOARD_TOKEN`.

For initial whole-site observation:

```env
AW_PROXY_ENABLED=true
AW_ORIGIN_URL=http://127.0.0.1:8081
AW_SHADOW_MODE=true
AW_SCORE_ENFORCEMENT_ENABLED=false
AW_GOOD_BOT_VERIFICATION_ENABLED=true
```

Do not rotate `AW_SECRET` casually; it keys sessions, Bot DNA IDs, and persisted client identity.

## 2. Reverse-proxy trust

If a front proxy supplies the real client address, set:

```env
AW_TRUST_PROXY=true
```

only if that proxy strips/overwrites incoming `X-Forwarded-For`. Never trust arbitrary client-supplied forwarding headers.

## 3. Good-bot DNS

The Node.js process needs working DNS resolution for Google/Bing verification. Verification results are cached:

```env
AW_GOOD_BOT_CACHE_MINUTES=1440
```

A DNS outage causes a claimed good bot to remain unverified; it does not by itself trigger quarantine.

## 4. Observe

Use `/dashboard.html` with the dashboard token. Review:

- verified good bots
- spoofed/failed good-bot claims
- Proof-of-Crawl events
- top Bot DNA profiles
- would-block counts

## 5. Optional manual policy

Copy Bot DNA IDs from the dashboard:

```env
AW_ALLOW_BOT_IDS=AW-1234ABCD
AW_QUARANTINE_BOT_IDS=AW-DEADBEEF
```

Restart the process after changing environment configuration.

## 6. Enable Proof-of-Crawl enforcement

After observing legitimate traffic:

```env
AW_SHADOW_MODE=false
AW_QUARANTINE_MODE=decoy
```

Convicted clients receive bounded HTTP 200 decoys, and their requests do not reach the origin.

## 7. Score enforcement (optional, later)

Only after tuning:

```env
AW_SCORE_ENFORCEMENT_ENABLED=true
AW_QUARANTINE_SCORE=100
```

## cPanel Node.js

Use `app.js` as the startup file, Node.js 20+ (newer LTS releases are fine), configure environment variables in the Node.js application UI, and route the desired hostname/application path to AnchorWeight. For true whole-site protection, the public website must route through the AnchorWeight application before the private origin.

## Nginx

An example is included at `deploy/nginx.conf.example`. In production add TLS, normal security headers, request-size limits, and appropriate proxy timeouts.

## Docker

```bash
docker compose up -d
```

Set production secrets and the actual origin URL through environment configuration rather than committing them.


## CLI deployment preflight

Before starting a proxy deployment, validate the effective configuration:

```bash
node bin/anchorweight.js check --proxy --origin http://127.0.0.1:8081 --shadow
```

The CLI is particularly useful when environment variables are supplied by cPanel, Docker, systemd, or a hosting control panel because `config` shows what AnchorWeight actually resolved without exposing secret values:

```bash
node bin/anchorweight.js config
```

After startup, verify the running service with `status`, then use `trap-test` while still in Shadow Mode. See `CLI.md` for the complete reference.


## v1.2.0 deployment gate

Before enabling enforcement, run `anchorweight doctor` with the same profile and origin settings used by the service. Keep `AW_SECRET` and `AW_DASHBOARD_TOKEN` in the hosting environment rather than committing them into a configuration profile. Back up state/evidence before upgrades and stop AnchorWeight before a restore.

## v1.2.0 production presets

Deployment examples are included under:

```text
deploy/cpanel/README.md
deploy/systemd/anchorweight.service
docker-compose.yml
```

For cPanel, prefer the hosting panel's **Setup Node.js App** workflow: set `app.js` as the startup file and configure secrets/environment variables through the UI. Terminal is not required for the normal cPanel setup.

Before routing public traffic through an enforcement-mode instance, verify `/live`, `/ready`, the dashboard/API, origin isolation, and `anchorweight doctor`.

## Optional SQLite storage (v1.2.0)

Set `AW_STATE_BACKEND=sqlite` only with Node 22.13+ and read
[SQLITE-MIGRATION.md](SQLITE-MIGRATION.md) first. JSON remains the default
on Node 20, 22 and 24. Do not run multiple workers against one SQLite file.

## v1.3 cPanel upgrade note

Retain the `async main()` entrypoint compatibility fix in `app.js` from v1.2; preserve the existing application root and environment. Upgrade the code with the existing storage backend first; SQLite migration is a separate optional operation. See [CANARY-EVIDENCE.md](CANARY-EVIDENCE.md).
