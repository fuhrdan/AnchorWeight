# AI Agent RC Readiness — AnchorWeight v3.1.0-rc.1

RC.1 is a stabilization release candidate. It adds no new AI request-enforcement behavior.

## RC.1 admission requirements

The static `ai-agents:rc-check` gate requires:

- exact version `3.1.0-rc.1` and release channel `rc`;
- all beta.2 stabilization prerequisites remain green;
- the v3 frozen contract hash remains exactly unchanged;
- the `v3.1.0-beta.2-validated` production-evidence record is present and complete;
- six critical AI request-path source files retain the exact Git blob identities from validated beta.2;
- Agent Passport AI Controls v10 publishes the additive RC readiness descriptor;
- AI policy remains shadow-first with enforcement disabled by default;
- the production validator retains 12-family canaries, authenticated checks, restart comparison, robots pass-through semantics and fail-closed privacy scanning;
- release-manifest verification remains available.

The RC gate is offline and non-mutating. It does not contact production and it does not grant enforcement readiness.

## Known hosting limitation

The validated HawkHost deployment reports `trusted_proxy_client_ip_unavailable`. RC.1 keeps this as an explicit warning. Provider network verification and client-scoped enforcement remain constrained and fail-safe disabled until the hosting boundary supplies a trustworthy original client address.

## After RC.1 builds

Deploy RC.1 in shadow mode, repeat production canaries/authenticated validation, and run a bounded RC burn-in. GA requires a later explicit release decision. Active AI deny enforcement remains a separate operator decision.
