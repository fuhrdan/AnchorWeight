# AnchorWeight v3.0.0-alpha.2 — Agent Behavior

Agent Behavior is the second observation layer in AnchorWeight 3.x. Agent Identity asks **what the client claims to be**; Agent Behavior records **how the traffic actually moves through the site**.

## Safety boundary

Alpha.2 is observation-only. These metrics do **not** add Bot DNA points, change the existing classification, trigger quarantine, alter gateway access, or select an adaptive intervention. They are evidence for later scoring and policy work.

The layer deliberately avoids retaining raw URLs, query strings, cookies, IP addresses, or user-agent strings. Route and cookie continuity use bounded HMAC-derived identifiers internally and only aggregate counts are exposed by the public profile.

## Metrics

- bounded route breadth
- unique URLs in the current minute
- maximum navigation depth
- GET / HEAD / other method mix
- suspected short-window retries of the same method + path
- cookie-presence continuity and bounded cookie-variant count
- API request concentration
- download-intent requests
- response observations and 404 rate
- download responses and bytes only when Content-Length is actually known
- robots.txt observations and disallowed blackhole visits
- lure / traversal / Proof-of-Crawl summary
- bounded timing samples and descriptive regularity percentage

## Interpretation

These are observations, not verdicts. A high API concentration can be a legitimate application client. Regular timing can be a scheduler. Missing cookies can be normal. A 404 can be a typo. Even a declared AI crawler remains only a declaration until stronger evidence exists.

Alpha.2 therefore does not convert any one metric into enforcement.

## Persistence

`profile.agentBehavior` uses JSON-safe arrays and counters, so it rides the existing JSON/SQLite profile persistence without a state-schema migration. All high-cardinality collections are bounded.

## Response hook

Alpha.2 attaches a `finish` listener after an ordinary request receives a trusted client identity. This lets the behavior layer observe final status codes and response metadata without changing the response body or delaying delivery.

## Next

The intended alpha.3 step is to derive separate `automationConfidence`, `policyRisk`, and `resourcePressure` dimensions from existing evidence plus Agent Identity and Agent Behavior—still with explicit safety gates before enforcement.
