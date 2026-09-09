# AnchorWeight Architecture

## Purpose

AnchorWeight is a defensive reverse proxy and crawler-identification system. It uses a bounded, cryptographically signed procedural lure to establish **Proof-of-Crawl**, then applies configurable site-local policy such as Shadow Mode observation or Silent Quarantine. The maze is a test, not a resource-exhaustion mechanism.

## Request path

```text
Internet / trusted front proxy
          |
          v
     AnchorWeight
          |
          +-- /live, /ready --------------------> operational health
          +-- /dashboard.html ------------------> operator UI
          +-- /anchor/api/* --------------------> authenticated admin API
          +-- /anchor/* ------------------------> signed Proof-of-Crawl lure
          |
          +-- trusted / normal client ----------> configured private origin
          |
          `-- quarantined client ---------------> deterministic inert HTTP 200 decoy
```

## Major modules

- `app.js`: HTTP entry point, liveness/readiness, routing, graceful shutdown.
- `src/proxy.js`: fixed-origin HTTP(S) reverse proxy with hop-by-hop-header stripping and body limits.
- `src/anchorweight.js`: Proof-of-Crawl orchestration, quarantine decisions, admin API.
- `src/procedural.js`: deterministic signed traversal lineage.
- `src/crypto.js`: HMAC helpers, timing-safe token comparison, keyed client fingerprints.
- `src/behavior.js`: Bot DNA scoring and traversal characterization.
- `src/goodbot.js`: supported good-bot reverse/forward DNS verification.
- `src/campaigns.js`: shared-signed-canary campaign correlation.
- `src/store.js`: in-memory runtime state.
- `src/persistent-store.js`: versioned atomic local state persistence.
- `src/migrations.js`: supported state-schema migration path.
- `src/admin-security.js`: bearer authentication support, CSRF sessions, admin rate limiting.
- `src/audit.js`: administrative audit trail.
- `src/logger.js`: bounded event logging and retention.
- `src/decoy.js`: deterministic, inert quarantine responses.
- `src/config.js` / `src/config-schema.js`: configuration loading and formal validation.
- `src/ops.js`: backups, restore, evidence reports, retention, state inspection/migration.

## Trust boundaries

The public network is untrusted. `X-Forwarded-For` is trusted only when `AW_TRUST_PROXY=true`, which must only be used behind a proxy that overwrites the header. The configured origin is a fixed operator-controlled destination and should not be publicly reachable when AnchorWeight is expected to protect the whole site. The dashboard token is an administrative credential.

## Persistence model

v1.0 uses a local JSON state file with atomic temp-file rename. It is suitable for a single AnchorWeight process. Multi-instance/load-balanced deployment requires a future shared datastore; do not point multiple writers at one state file.

## Enforcement principles

- Shadow Mode is the safe rollout default.
- Proof-of-Crawl is stronger evidence than generic request fingerprints.
- Score-only enforcement remains opt-in.
- Campaign correlation does not automatically quarantine all correlated members.
- Verified supported good bots bypass automatic enforcement unless explicitly quarantined.
- Quarantines are temporary rather than permanent IP bans.
