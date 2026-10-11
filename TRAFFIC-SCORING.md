# AnchorWeight v3.0.0-alpha.3 — Three-Dimensional Traffic Scoring

Alpha.3 separates three questions that should not be collapsed into one number:

1. **Automation Confidence (0–100)** — how confident AnchorWeight is that the traffic is automated.
2. **Policy Risk (0–100)** — how strongly observed behavior conflicts with operator/site policy.
3. **Resource Pressure (0–100)** — how much request velocity, breadth, retries, API concentration, and downloads may pressure origin resources.

These dimensions are derived from bounded, privacy-minimized observations already collected by Agent Identity, Agent Behavior, Proof-of-Crawl, Bot DNA, and explicit operator policy.

## Safety boundary

Alpha.3 is **observation-only** for the new dimensions. `BehaviorEngine.shouldQuarantine()` continues to use the legacy Bot DNA score and the existing `scoreEnforcementEnabled`/`quarantineScore` configuration. A high Automation Confidence, Policy Risk, or Resource Pressure score cannot independently block, throttle, deceive, or quarantine traffic in alpha.3.

This separation is intentional: a verified search crawler can have very high Automation Confidence with minimal Policy Risk, while a normal-looking client can create high Resource Pressure without being confidently identified as automation.

## Explainability

Each dimension exposes a bounded list of reasons and points. Example:

```json
{
  "trafficScores": {
    "version": 1,
    "enforcement": "legacy_score_only",
    "automationConfidence": {
      "score": 90,
      "level": "very_high",
      "reasons": [{"reason":"identity_declared_ai_crawler","points":90}]
    },
    "policyRisk": {"score":0,"level":"minimal","reasons":[]},
    "resourcePressure": {"score":20,"level":"low","reasons":[...]},
    "legacy": {"score":0,"classification":"unknown"}
  }
}
```

## Interpretation

- **Automation Confidence is not maliciousness.** User-directed agents and verified crawlers should often score high here.
- **Policy Risk is not identity.** It reflects concrete policy conflicts such as robots-disallowed visits, invalid signed traversal, spoofed verified-crawler claims, and repeated probing patterns.
- **Resource Pressure is not intent.** It reflects server-impact indicators such as velocity, breadth, retries, API concentration, and observed download volume.

## Compatibility

No state-schema migration is required. Scores are derived from existing profile observations and are therefore available to older persisted profiles with partial/default data. The legacy `score`, `classification`, and enforcement path remain intact.
