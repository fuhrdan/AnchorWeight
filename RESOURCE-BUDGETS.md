# AnchorWeight v3.0.0-beta.1 — Resource Budgets

Resource Budgets turn the alpha-series `resourcePressure` observations into explicit, operator-configured operating envelopes without turning them into automatic punishment.

## Design goal

A busy or automated client is not automatically malicious. Beta.1 therefore separates **budget state** from **enforcement**:

- `within_budget` — current observations are below the approach threshold;
- `approaching` — one or more dimensions have reached the configured approach percentage;
- `exceeded` — one or more configured limits have been reached or exceeded;
- `disabled` — Resource Budgets are not enabled.

Every beta.1 budget result reports `enforcement: "shadow_only"`. No budget state can throttle, quarantine, block, decoy, alter gateway access, or change the legacy Bot DNA score.

## Budget dimensions

Beta.1 evaluates five bounded dimensions:

1. **Requests per minute** — current per-profile request count for the active minute bucket.
2. **Unique URLs per minute** — privacy-minimized unique route hashes in the active minute bucket.
3. **Five-minute route breadth** — deduplicated route hashes across the last five bounded minute buckets.
4. **Retries per minute** — requests that repeated the same method/path within the existing 10-second retry window, counted in the current minute.
5. **Resource Pressure** — the existing v3 0–100 Resource Pressure score.

Raw paths, query strings, cookies, IP addresses, and User-Agent values are not exposed by Resource Budgets.

## Configuration

Resource Budgets are opt-in in beta.1:

```text
AW_RESOURCE_BUDGETS_ENABLED=false
AW_RESOURCE_BUDGET_REQUESTS_PER_MINUTE=120
AW_RESOURCE_BUDGET_UNIQUE_URLS_PER_MINUTE=60
AW_RESOURCE_BUDGET_ROUTE_BREADTH_5M=120
AW_RESOURCE_BUDGET_RETRIES_PER_MINUTE=20
AW_RESOURCE_BUDGET_PRESSURE_SCORE=70
AW_RESOURCE_BUDGET_APPROACH_PERCENT=80
```

Recommended rollout:

1. Leave budgets disabled during the first production restart.
2. Review the Agent Traffic Observatory and current Resource Pressure distribution.
3. Enable `AW_RESOURCE_BUDGETS_ENABLED=true` with conservative limits.
4. Observe `approaching` and `exceeded` profiles in shadow mode.
5. Tune limits before beta.2 introduces the Policy Engine that can consume budget state.

## Safety boundary

Beta.1 deliberately does **not** add an enforcement switch. This is an observation and calibration release. The future Policy Engine must make an explicit, separately configured decision before budget state can influence a response.
