# AnchorWeight v3 Policy Engine — beta.2

Beta.2 introduces an explainable policy decision layer above Agent Identity, Agent Behavior, three-dimensional traffic scoring, and Resource Budgets.

## Action ladder

`ALLOW → OBSERVE → BUDGET → THROTTLE → DECOY → QUARANTINE`

The ladder is not a single bot score. Automation Confidence answers whether traffic appears automated; Policy Risk represents concrete policy conflicts; Resource Pressure represents cost/velocity; Resource Budgets represent operator-defined capacity boundaries.

## Priority rules

1. Explicit operator `allow` wins.
2. Explicit operator `quarantine` wins over automatic policy.
3. Verified search crawlers are allowed unless explicitly quarantined.
4. Corroborated very-high Policy Risk may recommend quarantine.
5. High Policy Risk may recommend a bounded decoy.
6. Exceeded budgets plus automated/high-pressure behavior may recommend throttling.
7. Approaching budgets produce a budget posture.
8. Automation or moderate evidence produces observation rather than punishment.
9. Ordinary low-pressure traffic is allowed.

## Enforcement gates

Beta.2 is shadow-first. A THROTTLE, DECOY, or QUARANTINE recommendation is executed only when all of these are true:

- `AW_POLICY_ENGINE_ENABLED=true`
- `AW_POLICY_ENGINE_ENFORCEMENT_ENABLED=true`
- `AW_POLICY_ENGINE_SHADOW_MODE=false`
- global `AW_SHADOW_MODE=false`
- client identity is enforcement-safe

Defaults do **not** execute Policy Engine interventions.

## Configuration

```text
AW_POLICY_ENGINE_ENABLED=true
AW_POLICY_ENGINE_SHADOW_MODE=true
AW_POLICY_ENGINE_ENFORCEMENT_ENABLED=false
AW_POLICY_OBSERVE_AUTOMATION=65
AW_POLICY_THROTTLE_PRESSURE=70
AW_POLICY_DECOY_RISK=65
AW_POLICY_QUARANTINE_RISK=85
AW_POLICY_THROTTLE_SECONDS=30
AW_POLICY_QUARANTINE_MINUTES=60
```

## Safety properties

- Policy evaluation is pure and does not change legacy Bot DNA score.
- Resource Budget status remains advisory; the Policy Engine is the layer that interprets it.
- Degraded proxy identity continues to suppress client-scoped enforcement.
- Manual allow and verified good-bot precedence are preserved.
- Throttle is bounded HTTP 429 with Retry-After.
- Decoy uses AnchorWeight's existing bounded inert decoy response.
- Quarantine uses the existing bounded block store and expiry behavior.
- No new runtime dependency and no state-schema migration are required.

## Beta.3 calibration

Beta.3 layers bounded Policy Forensics over the beta.2 evaluator. It does not change thresholds or enforcement gates; it adds decision/reason counters and a short transition trail so operators can calibrate the existing policy before enabling enforcement.
