# AnchorWeight v2.8.0 — Adaptive Deception Foundation

v2.8 adds a shadow-first behavioral intervention layer inspired by adaptive cyber-deception research. It does **not** infer human psychology and does not autonomously attack, exploit, or harm clients.

## Goals
- Measure attacker cost: diverted requests, shadow traversals, decoy interactions, induced depth, estimated traversal delay, and origin requests prevented.
- Recommend explainable interventions from observable behavior.
- Persist a bounded intervention history in Bot DNA.
- Keep recommendations observational by default. v2.8 does not automatically quarantine based on adaptive-deception recommendations.

## Interventions
`normal_response`, `shadow_branch`, `signed_decoy`, `depth_extension`, `rate_friction`, `reauth_challenge`, and `quarantine` are registered names. v2.8 recommends only low-risk strategies automatically; later releases may add operator-approved enforcement.

## Configuration
- `AW_ADAPTIVE_DECEPTION_ENABLED=true` — enable measurement/recommendations.
- `AW_ADAPTIVE_DECEPTION_SHADOW_MODE=true` — required/recommended for v2.8 production rollout.
- `AW_ADAPTIVE_DECEPTION_HISTORY_LIMIT=24` — bounded per-profile history (4–100).

Roll out with `AW_SHADOW_MODE=true` and score enforcement disabled until sufficient production telemetry has been reviewed.
