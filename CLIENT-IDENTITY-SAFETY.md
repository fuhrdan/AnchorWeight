# AnchorWeight v2.9.2 — Proxy Identity Safety

AnchorWeight must not treat a shared reverse-proxy hop such as 127.0.0.1 as one Internet client. v2.9.2 detects that condition at runtime.

## Runtime states

- **trusted** — AnchorWeight has a usable client address from the direct socket, or from X-Forwarded-For when AW_TRUST_PROXY=true.
- **degraded** — AnchorWeight detects a proxy hop but no trusted client address is available. Client-scoped enforcement is suppressed.

A degraded identity does not make the reverse proxy unhealthy. /ready continues to report origin readiness while also exposing clientIdentity.enforcementSafe=false.

## Enforcement behavior

When identity is degraded, AnchorWeight continues to proxy traffic and collect aggregate observatory telemetry. It does not create one shared Bot DNA profile for ordinary proxied traffic, apply Bot DNA quarantine, run score enforcement against the shared hop, or apply gateway IP/rate decisions to that shared hop.

Signed lure traversal remains useful. Each lure session receives a session-only identity, so Proof-of-Crawl can be recorded without claiming that the evidence belongs to a stable network client. Session-only proofs never create a client quarantine.

## Forwarded-header safety

The protected origin receives a canonical X-Forwarded-For only when AnchorWeight has a trusted client identity. Caller-supplied Forwarded, X-Forwarded-For, X-Real-IP, X-Client-IP, X-Cluster-Client-IP, CF-Connecting-IP and True-Client-IP are stripped before proxying.

## cPanel / Passenger / LiteSpeed

If Passenger exposes only 127.0.0.1 plus X-Forwarded-Proto/X-Forwarded-Host, leave AW_TRUST_PROXY=false. AnchorWeight will run in degraded client-identity mode safely. Ask the hosting provider to supply a sanitized, server-generated X-Forwarded-For value. Only then set AW_TRUST_PROXY=true and restart.

## Validation

After restart, check:

    curl -s https://YOUR-SITE/live
    curl -s https://YOUR-SITE/ready

Look for clientIdentity.status and clientIdentity.enforcementSafe. Use the authenticated dashboard/stats API to confirm trackedProfiles no longer grows from ordinary shared-proxy traffic while aggregate traffic telemetry continues to increase.
