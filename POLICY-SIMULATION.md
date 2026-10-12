# AnchorWeight Policy Simulation — v3.0.0-beta.4

Beta.4 adds authenticated, read-only **Policy Simulation / What-If Analysis**.
It lets an operator ask how currently observed Bot DNA profiles would be classified
under alternate Policy Engine thresholds without changing the running configuration,
profile state, block state, or enforcement behavior.

## What can be simulated

The simulator accepts four bounded thresholds (1–100):

- `observeAutomation` — Automation Confidence threshold for OBSERVE.
- `throttlePressure` — Resource Pressure threshold used by THROTTLE logic.
- `decoyRisk` — Policy Risk threshold for DECOY.
- `quarantineRisk` — Policy Risk threshold for corroborated QUARANTINE.

`decoyRisk` must not exceed `quarantineRisk`.
Omitted values inherit the currently configured threshold.

## Safety properties

Simulation is deliberately separated from enforcement.

- Candidate evaluation always forces `shadowMode=true`.
- Candidate evaluation always forces `policyEngineShadowMode=true`.
- Candidate evaluation always forces `policyEngineEnforcementEnabled=false`.
- No profile is modified.
- No configuration file is modified.
- No quarantine or throttle is created.
- No origin request is redirected.
- The endpoint is available only through the authenticated operator API.

## Privacy

Simulation consumes already-public Bot DNA profile projections. Results contain only
bounded Bot DNA IDs, policy actions, reason codes, score dimensions, and budget status.
It does not return raw IP addresses, user agents, request paths, query strings, cookies,
headers, credentials, or origin addresses.

## Endpoint

`POST <basePath>/api/policy/simulate`

Example body:

```json
{
  "observeAutomation": 60,
  "throttlePressure": 65,
  "decoyRisk": 60,
  "quarantineRisk": 85
}
```

The endpoint uses the same dashboard bearer authentication as the other operator APIs.
It is read-only and does not require a CSRF token because the bearer credential is not
a browser ambient credential and the operation cannot mutate server state.

## Bounded calibration set

A simulation evaluates at most 500 public profiles and returns at most 25 changed-profile
details. If more profiles exist, `truncated` is true and `totalProfiles` reports the larger
population. The bounded sample is deterministic and prioritizes request volume, then legacy score, with a stable Bot DNA-key tie break.

## Result summary

The response reports:

- current and simulated action distributions,
- changed and unchanged profile counts,
- escalations and de-escalations,
- current and simulated high-impact recommendations,
- a bounded changed-profile table with current/simulated action and safe score metadata.

Policy Simulation is a calibration aid, not an enforcement command.
