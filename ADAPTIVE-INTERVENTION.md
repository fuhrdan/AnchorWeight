# AnchorWeight v2.9 — Adaptive Intervention Engine

v2.9 adds a deterministic, bounded decision layer above v2.8 adaptive-deception recommendations.

## Defaults
`AW_ADAPTIVE_INTERVENTION_ENABLED=true`
`AW_ADAPTIVE_INTERVENTION_SHADOW_MODE=true`
`AW_ADAPTIVE_INTERVENTION_COOLDOWN_MS=30000`
`AW_ADAPTIVE_INTERVENTION_HISTORY_LIMIT=32`
`AW_ADAPTIVE_INTERVENTION_ALLOWED=normal_response,shadow_branch,signed_decoy,depth_extension,rate_friction`

The engine remains shadow-first. Reauthentication and quarantine are intentionally excluded from adaptive selection; existing explicit AnchorWeight policy remains authoritative.

## Decision loop
Recommendations pass through an allowlist, per-intervention cooldown, prior effectiveness, and deterministic fallback selection. Effectiveness uses only observable follow-on events (decoy engagement, invalid traversal, continued deep traversal, continued proof-of-crawl), not claims about attacker psychology.

Public Bot DNA projections expose bounded v2.8 attacker-cost history plus v2.9 decision/effectiveness history so the Investigation Console/API can inspect why a strategy was recommended and what followed.
