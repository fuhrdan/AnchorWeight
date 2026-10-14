# AnchorWeight v3.1 AI Agent Burn-In & Readiness

Alpha.7 is a release-hardening build. It adds no new enforcement behavior.

## Goal

Prove the alpha.1 through alpha.6 AI-agent stack works together and is ready for **v3.1 beta review** while preserving the frozen v3.0 safety/privacy contract.

## Gate

```sh
npm run ai-agents:burnin-check
```

A successful run ends with:

```text
AnchorWeight 3.1.0-alpha.7 AI Agent Burn-In PASS (... invariants checked)
READY FOR v3.1 BETA REVIEW
```

The readiness verdict is deliberately narrower than enforcement readiness. It does **not** authorize active deny enforcement.

Use `--json` for machine-readable output:

```sh
node scripts/ai-agent-burnin-check.js --json
```

## What it verifies

- all six earlier v3.1 AI gates still pass;
- all 12 declared AI-agent family canaries resolve to the expected provider/family/purpose;
- the frozen v3.0 contract SHA-256 is unchanged;
- frozen privacy flags remain false;
- the frozen policy action ladder is unchanged;
- observability remains bounded and non-enforcing;
- policy-manager exports remain shadow-first;
- controlled deployment remains shadow-only, manual-activation, manual-restart, and rollback-capable;
- dashboard operator surfaces remain present with no enforcement-enable control;
- runtime/API wiring remains present;
- runtime files contain no stale alpha/beta/RC version string;
- source-manifest verification remains wired into the authoritative release check.

## Required final release sequence

The burn-in gate does not replace the normal suite or release manifest verification:

```sh
node scripts/test-suite.js
npm run ai-agents:burnin-check
npm run security:check
node scripts/release-check.js
node scripts/release-check.js --verify
```

## HawkHost limitation

A beta-review verdict does not remove the trusted-client-identity requirement for client-scoped controls. If the hosting proxy still does not supply a trustworthy sanitized original client identity, client-scoped enforcement remains blocked.

## No feature expansion

Alpha.7 intentionally does not add:

- automatic policy activation;
- automatic Passenger/Node restart;
- active AI deny enablement;
- new identity trust semantics;
- persistent raw IP/User-Agent/path/query collection.
