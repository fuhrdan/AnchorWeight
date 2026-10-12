# AnchorWeight v3.0.0-beta.3 — Policy Forensics + Calibration

Beta.3 makes the beta.2 Policy Engine easier to inspect and tune without expanding enforcement.

## Goals

- Explain how often policy decisions are evaluated.
- Count action and reason-code frequency.
- Record meaningful action/reason transitions without logging duplicate evaluations as duplicate history rows.
- Surface high-impact recommendations (THROTTLE, DECOY, QUARANTINE) separately from actual enforcement eligibility.
- Give operators calibration data before any production enforcement is enabled.

## Privacy boundary

Policy Forensics stores only bounded decision metadata:

- action;
- reason codes;
- Automation Confidence, Policy Risk and Resource Pressure scores;
- Resource Budget status;
- whether the action would enforce in an eligible configuration;
- whether enforcement was actually eligible at evaluation time;
- timestamps and aggregate counters.

It does **not** store or expose raw IP addresses, user agents, request paths, query strings, cookies, headers, credentials, origin URLs, monitor labels, or exact screen enumeration.

## Bounded history

Every evaluation increments calibration counters, but the recent decision trail only appends when the action/reason posture changes. The trail is capped at 12 entries per profile.

This prevents multiple evaluations around the same request from creating misleading duplicate history.

## Enforcement posture

Beta.3 does not add a new enforcement path and does not change beta.2 policy thresholds. Existing gates remain required for THROTTLE, DECOY or QUARANTINE:

1. Policy Engine enabled;
2. explicit Policy Engine enforcement enabled;
3. Policy Engine shadow mode disabled;
4. global Shadow Mode disabled;
5. enforcement-safe client identity.

If client identity is degraded, client-scoped Policy Engine enforcement remains suppressed.

## Observatory calibration

The authenticated Agent Traffic Observatory now aggregates:

- policy evaluations;
- policy transitions;
- high-impact recommendations;
- transition rate;
- bounded reason-code counts.

These values are intended for threshold calibration and release-readiness review before RC enforcement decisions.
