# AI Agent Policy Deployment — v3.1 alpha.6

Alpha.6 adds a controlled bridge between a saved alpha.5 policy draft and a hosting deployment.

## Safety boundary

Alpha.6 **does not edit cPanel environment variables**, **does not restart Node/Passenger**, does not mutate the current runtime policy, and does not provide a control that enables active AI-agent enforcement.

Preparation writes private mode-0600 artifacts under `data/`:

- `ai-agent-policy-shadow.env` — candidate environment with shadow mode forced on and enforcement forced off.
- `ai-agent-policy-rollback.json` — snapshot of the current runtime AI-agent policy.
- `ai-agent-policy-deployment.json` — the prepared plan identifier and preparation metadata.
- `ai-agent-policy-rollback.env` — generated only when an operator explicitly prepares rollback.

## Controlled workflow

1. Save a valid draft in the alpha.5 Policy Manager.
2. Review the live-vs-draft diff and bounded rehearsal against alpha.4 observations.
3. Review risk flags.
4. Enter the exact confirmation phrase `PREPARE SHADOW DEPLOYMENT`.
5. If high-risk changes are present, separately acknowledge those risks.
6. Prepare the shadow deployment artifacts.
7. Apply the generated values through the hosting control plane and restart the application manually.
8. Verify AI-agent observability while the policy remains shadow-only.

Rollback preparation uses the exact phrase `PREPARE SHADOW ROLLBACK` and also forces enforcement disabled.

Alpha.6 is rehearsal infrastructure. Active deny enforcement remains a separate later decision.
