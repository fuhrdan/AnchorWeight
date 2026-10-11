# AnchorWeight v3.0.0-alpha.5 — Agent Passport

Alpha.5 adds a public, read-only capability descriptor at:

`/.well-known/anchorweight`

The Agent Passport gives crawlers, user-directed agents, operators and integration tooling a stable way to discover what an AnchorWeight-protected site can observe and enforce without exposing private configuration.

## Public fields

The passport publishes:

- AnchorWeight version and passport schema version;
- supported traffic classes and declared purposes;
- availability of Agent Identity and Agent Behavior;
- the three explainable traffic-score dimensions;
- the authenticated Agent Traffic Observatory capability;
- bounded Proof-of-Crawl availability;
- current public enforcement posture such as Shadow Mode and legacy-score enforcement;
- explicit statements that alpha.5 does **not** enforce Automation Confidence, Policy Risk or Resource Pressure;
- privacy guarantees for raw IPs, User-Agent values, paths, queries, cookies, origins and credentials.

## What it does not publish

The passport intentionally excludes:

- origin URLs;
- dashboard or API tokens;
- application credentials;
- AnchorWeight signing secrets;
- raw client identifiers;
- raw User-Agent values;
- trap paths or signed lure tokens;
- raw request paths, query strings or cookies.

## HTTP behavior

`GET /.well-known/anchorweight` returns JSON with a short public cache lifetime and CORS enabled.

`HEAD /.well-known/anchorweight` returns the same metadata headers without a body.

Other methods receive `405 Method Not Allowed`.

## Enforcement boundary

The Agent Passport is descriptive only. Alpha.5 keeps the alpha.3/alpha.4 enforcement boundary unchanged: the legacy Bot DNA score remains the sole score-based enforcement source. Resource Budgets and the v3 Policy Engine remain future work.
