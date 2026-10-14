# AI Agent Policy Manager — v3.1.0-alpha.5

Alpha.5 adds an authenticated operator workflow for editing and reviewing AI-agent policy without creating a dashboard path to enforcement.

## Safety contract

The manager can validate a draft, preview it against the bounded Alpha.4 AI-agent observatory, save the draft to a private local file, and export canonical environment settings. Saving a draft does **not** change the running AnchorWeight configuration. Exported settings always contain:

```text
AW_AI_AGENT_POLICY_SHADOW_MODE=true
AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=false
```

Enabling enforcement remains a separate operator action outside the policy manager.

## Draft schema

`anchorweight-ai-agent-policy-draft/v1` contains only purpose actions, family rules, and verification-aware rules. Enforcement fields are rejected.

## Dashboard workflow

1. Load the current runtime policy or previously saved draft.
2. Edit purpose defaults and exact rules.
3. Preview against the most recent bounded AI-agent decisions.
4. Resolve validation errors or warnings.
5. Save the private draft if desired.
6. Export JSON or canonical environment configuration.
7. Apply exported configuration separately through the deployment environment and restart AnchorWeight.

## Persistence and privacy

The draft is stored locally at `data/ai-agent-policy-draft.json` with mode 0600. It contains policy only—no credentials, IP addresses, User-Agent strings, paths, queries, or cookies. Preview consumes only the already-redacted Alpha.4 observatory snapshot.
