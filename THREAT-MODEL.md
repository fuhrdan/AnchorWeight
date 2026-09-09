# AnchorWeight Threat Model

## Assets to protect

1. The private/original website content and origin capacity.
2. Operator credentials and administrative policy controls.
3. Integrity of Bot DNA, campaign, quarantine, and evidence state.
4. Availability of the AnchorWeight proxy itself.
5. Privacy of source-network information collected for defensive classification.

## Expected adversaries

- Automated recursive crawlers ignoring normal crawling expectations.
- Scrapers rotating headers or source addresses.
- Bots claiming search-engine User-Agents without valid provider DNS provenance.
- Distributed crawlers sharing discovered signed URLs between workers.
- Opportunistic callers probing administrative endpoints.

## Key controls

- HMAC-signed, sequential Proof-of-Crawl lineage.
- Bounded depth/session TTL rather than infinite loops or large-resource traps.
- Silent Quarantine that prevents convicted clients from reaching the origin.
- Keyed client fingerprints rather than raw IPs in normal dashboard/event views.
- Reverse + forward DNS checks for supported good-bot identities.
- Bearer-only admin auth by default, CSRF tokens for mutations, separate admin-rate-limit buckets.
- Bounded admin and proxy request bodies.
- Versioned atomic persistence and explicit state migrations.
- Log size/retention limits, graceful shutdown, readiness checks.

## Important non-goals and residual risks

AnchorWeight does not promise perfect bot attribution. Shared NAT, VPNs, mobile networks, compromised clients, distributed systems, and source rotation can make IP-derived identities imperfect. It therefore avoids permanent automatic bans and keeps campaign-wide enforcement informational by default.

AnchorWeight does not protect a site if an attacker can bypass it and directly reach the origin. Origin isolation is an infrastructure requirement.

Good-bot DNS verification depends on DNS availability and provider naming practices. DNS failure results in **unverified**, not automatically malicious.

The local JSON store is not a distributed database. Single-instance operation is the supported v1.0 persistence topology.

## Abuse-resistance principle

AnchorWeight must not intentionally consume excessive crawler CPU, bandwidth, disk, memory, or connection time. The procedural namespace provides evidence; it is not designed as an offensive tarpit.
