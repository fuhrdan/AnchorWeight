# AnchorWeight v3.0.0-beta.5 — Release Calibration & Readiness

Beta.5 adds an authenticated, advisory-only readiness assessment for operators preparing for a controlled enforcement trial.

## Goals

- Keep enforcement opt-in and fail-safe.
- Make client-identity safety a hard readiness prerequisite.
- Require meaningful shadow Policy Engine observations before recommending enforcement review.
- Use analyst reviews (`false_positive` and `confirmed_automation`) as labeled calibration evidence.
- Refuse to invent threshold recommendations when evidence is insufficient or overlapping.
- Keep threshold suggestions advisory; no configuration or state is changed.
- Make an external full test/release gate an explicit prerequisite.

## Runtime verdicts

`blocked`
: A hard safety prerequisite is missing, such as trusted client identity, a protected reverse-proxy path, or the Policy Engine itself.

`calibrating`
: Hard prerequisites are present, but shadow observations, analyst labels, or intervention stability are not yet sufficient.

`ready_for_controlled_enforcement_review`
: Runtime prerequisites and evidence thresholds are satisfied. This is **not** automatic permission to enforce; the operator must still run the full test/release gate, review simulations, and explicitly opt in.

## Default evidence requirements

- at least 100 Policy Engine evaluations;
- at least 10 labeled profiles total;
- at least 3 `false_positive` reviews;
- at least 3 `confirmed_automation` reviews;
- high-impact recommendation rate at or below 25%;
- trusted/enforcement-safe client identity;
- reverse proxy enabled;
- Policy Engine enabled.

## Threshold calibration

For Automation Confidence, Resource Pressure, and Policy Risk, beta.5 looks for a measurable separation between reviewed false positives and reviewed confirmed automation. When the classes overlap materially, the recommendation is to hold the current threshold.

Quarantine remains more conservative: beta.5 requires corroborated confirmed-automation profiles (Proof-of-Crawl, blackhole evidence, or repeated invalid traversal evidence) before suggesting a different quarantine threshold.

## Privacy

Readiness consumes only public Bot DNA projections and aggregate calibration counters. It does not require raw IPs, user agents, paths, queries, cookies, credentials, origins, or request headers.

## Enforcement

Beta.5 does not turn on enforcement, disable shadow mode, alter Policy Engine actions, change thresholds, write candidate configuration, create blocks, or mutate Bot DNA profiles.
