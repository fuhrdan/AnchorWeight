# AnchorWeight v3.0.0-rc.1 — Release Candidate Hardening

## Feature freeze

RC.1 freezes the externally visible v3 feature surface shipped in v3.0.0-beta.7.
No new traffic signals, scoring dimensions, policy actions, enforcement paths, public
capabilities, or persistent-state schemas are introduced in RC.1.

Allowed RC changes are limited to correctness/security fixes, compatibility/deployment
fixes, tests/release tooling, documentation, and observability corrections that do not
change policy semantics. A new capability or state migration leaves the RC line.

## Frozen contract

`RC1-FROZEN-CONTRACT.json` records the beta.7 production contract: Agent Passport
schema/capabilities, Policy Engine action ladder, non-enforcement defaults, privacy
invariants, and the trusted-client-identity/external-release gates.

Run:

```bash
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run rc:check
```

The normal `release-check.js` also invokes the same in-process RC hardening gate.

## Required RC.1 gates

1. Full test suite: zero failures, cancellations, or skips.
2. RC hardening check: PASS.
3. Release check: PASS and manifest regenerated.
4. Release verification: PASS.
5. Clean-install smoke test.
6. beta.7 -> rc.1 upgrade smoke test.
7. rc.1 -> beta.7 code rollback rehearsal.
8. Production shadow-mode smoke test.
9. Security/dependency review.
10. No enforcement trial while client identity is degraded.

## Clean install

Use a temporary clean directory, never production state. Start with fresh configuration
in shadow mode and verify `/live`, `/ready`, dashboard authentication, Agent Passport,
setup read-only behavior, and CLI version. No production credentials/state/logs should
be required for startup.

## Upgrade and rollback

RC.1 performs no persistent-state migration. Test the updater against a copy of the
beta.7 installation, confirm existing configuration/state remain readable, then rehearse
rollback by restoring beta.7 code against the same copied state. Keep backups regardless.

## HawkHost / LiteSpeed constrained-host procedure

Before authoritative gates, stop AnchorWeight in cPanel and verify stale AnchorWeight
`app.js` processes are gone. Generic LiteSpeed 503 responses and native
`uv_thread_create`/SIGABRT failures can indicate account process/thread exhaustion.
Terminate only stale AnchorWeight workers; do not touch unrelated account applications.

## Security review before RC.2

- `npm audit --audit-level=high`
- authentication and CSRF regression review
- SSRF/origin restrictions
- proxy identity fail-closed behavior
- raw IP/header/path/query/cookie/credential privacy invariants
- Policy Simulation, Enforcement Rehearsal, and Release Readiness remain non-mutating
  and non-enforcing
- release source contains no secrets

## Known blocker

HawkHost/LiteSpeed still does not provide a trustworthy sanitized original client IP to
Passenger. `clientIdentity.enforcementSafe` must remain false. This does not block RC
shadow burn-in, but it blocks a client-scoped production enforcement trial.
