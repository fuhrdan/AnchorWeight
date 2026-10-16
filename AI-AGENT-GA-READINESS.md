# AI Agent GA Readiness — AnchorWeight v3.1.0

v3.1.0 GA is a stable promotion of the production-validated v3.1.0-rc.1 code line. It adds no new AI request-enforcement behavior.

## GA admission requirements

`npm run ai-agents:ga-check` requires:

- exact version `3.1.0` and release channel `stable`;
- the RC.1 prerequisite gate remains green;
- the frozen v3 contract SHA-256 remains byte-identical;
- the RC.1 production/burn-in admission record is complete;
- six critical AI request-path files retain the exact Git blob identities validated through beta.2 and RC.1;
- Agent Passport AI Controls v11 publishes additive `gaReadiness`;
- shadow-first defaults remain enabled and AI enforcement remains disabled by default;
- production validation retains 12 canaries, authenticated checks, restart comparison, robots pass-through semantics, and fail-closed privacy scanning;
- release-manifest verification remains wired.

The GA static gate is offline and non-mutating. A successful GA gate permits the stable release; it does not grant AI enforcement readiness.

## Post-deploy requirement

After tagging/deploying v3.1.0, run the production validator again against the GA binary. GA readiness explicitly requires this final production confirmation.

## Client identity

The accepted RC.1 evidence records the HawkHost client identity as degraded (`trusted_proxy_client_ip_unavailable`, `enforcementSafe:false`). That is an explicit warning, not permission to weaken the trust boundary. Provider verification/client-scoped enforcement remains fail-safe constrained whenever trustworthy client identity is unavailable.

## Enforcement

Do not enable active AI deny enforcement as part of the GA promotion. Treat enforcement as a separate post-GA controlled rollout.
