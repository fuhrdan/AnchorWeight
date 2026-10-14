# AI Agent Observability

AnchorWeight v3.1.0-alpha.4 adds a bounded, authenticated view of AI-agent access decisions.

## What it records

For requests that already match the v3.1 AI-agent identity taxonomy, AnchorWeight records aggregate counts for:

- provider and family
- declared purpose
- verification status (`verified`, `unverified`, `unavailable`, `disabled`)
- resolved action (`allow`, `observe`, `deny`)
- outcome (`allowed`, `observed`, `would_deny`, `denied`)
- whether a verification-aware rule matched
- declaration-policy vs verification-rule decision source

A bounded list of the most recent 24 AI-agent decisions is kept in memory.

## What it does not record

The AI-agent observatory does not retain or expose:

- raw client IP addresses
- raw `User-Agent` strings
- request paths
- query strings
- cookies
- credentials

It receives the already-resolved provider/family/policy result rather than parsing raw request identity again.

## Lifetime and bounds

The observatory is process-local and resets when the Node process restarts. It stores at most 32 family buckets and 24 recent decision summaries. This keeps alpha.4 suitable for shared-hosting and low-resource deployments without a state-schema migration.

## Authenticated endpoints

The existing authenticated stats endpoint includes:

`GET <basePath>/api/stats`

with an `aiAgentTraffic` object.

Alpha.4 also adds a focused authenticated endpoint:

`GET <basePath>/api/ai-agents`

Both require the existing dashboard authentication.

## Dashboard

The operator dashboard adds **AI Agent Access Observatory** with:

- declared request count
- verified / unverified / unavailable counts
- allowed / observed / would-deny / denied outcomes
- verification-aware policy match count
- provider and family breakdowns
- bounded recent decisions

`unverified` means the request declaration did not match the provider-published verification data available to AnchorWeight. It is useful spoofing evidence, but the dashboard does not label it as proven malicious behavior.

## Enforcement

Observability does not add an enforcement path. It cannot allow, block, quarantine, or confer trust. Alpha.1 declaration policy and alpha.3 verification-aware policy remain the decision owners.
