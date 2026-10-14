# AnchorWeight v3.1 Beta Validation

v3.1.0-beta.1 begins stabilization of the AI-agent control stack developed in alpha.1 through alpha.7.

Beta.1 intentionally adds **no new enforcement behavior**.

## Required beta validation sequence

On the constrained HawkHost environment:

```sh
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" node scripts/test-suite.js
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run ai-agents:check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run ai-agents:verify
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run ai-agents:policy-check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run ai-agents:observability-check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run ai-agents:policy-manager-check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run ai-agents:deployment-check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run ai-agents:burnin-check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run ai-agents:beta-check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run security:check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" node scripts/release-check.js
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" node scripts/release-check.js --verify
```

The beta gate can also produce JSON:

```sh
node scripts/ai-agent-beta-check.js --json
```

## Beta acceptance criteria

A beta.1 build is acceptable for validation only when all of the following are true:

- the full constrained-host test suite has zero fail/cancelled/skipped/todo results;
- all six original v3.1 AI gates pass;
- alpha.7 burn-in still passes all 12 family canaries;
- the frozen v3.0 contract SHA-256 remains unchanged;
- frozen privacy flags and the policy action ladder remain unchanged;
- observability remains bounded and non-enforcing;
- policy-manager export remains shadow-first;
- policy deployment remains shadow-only, requires explicit confirmation, and never auto-restarts;
- the dashboard has no active-enforcement enable control;
- npm audit reports no high-severity vulnerabilities;
- source manifest check and verify both pass.

## Operator workflow

1. Keep active AI-agent enforcement disabled during beta.1 validation.
2. Use the policy manager to inspect or save a draft.
3. Preview the draft against bounded observed AI-agent traffic.
4. Prepare a shadow deployment only after reviewing the plan and risks.
5. Apply generated environment values manually through the hosting control plane.
6. Restart Node/Passenger manually.
7. Confirm the dashboard shows expected shadow behavior and no unexpected traffic regressions.
8. Exercise rollback preparation and retain the rollback environment before considering later enforcement trials.

## HawkHost limitation

The beta stabilization verdict does not change the known client-identity limitation. If the hosting proxy does not provide a trustworthy sanitized original client IP, client-scoped enforcement remains blocked.

AI-agent declaration-based deny is a separate stateless request policy, but provider verification still requires trustworthy client identity.

## What beta.1 does not do

- no automatic activation;
- no automatic restart;
- no automatic deny enforcement;
- no new provider trust semantics;
- no new raw-IP/User-Agent/path/query retention;
- no relaxation of the frozen v3.0 contract.
