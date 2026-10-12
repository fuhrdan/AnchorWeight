# AnchorWeight v3.0.0-rc.2 — Production Burn-In

RC.2 is an operational burn-in release. The v3 product feature surface remains frozen
at the contract established in RC.1. RC.2 does not add traffic signals, policy actions,
state migrations, or enforcement behavior.

## Static gate

Run while the production application is stopped for authoritative release testing:

```bash
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run burnin:check
```

The static gate verifies the central RC.2 version, package/lock ownership, the unchanged
RC.1 frozen contract, Agent Passport capability surface, action ladder, privacy flags,
non-enforcement defaults, and required RC.2 artifacts.

## Live production check

After starting the cPanel/LiteSpeed application:

```bash
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" node scripts/burn-in-check.js --url https://newlands-games.com --local-processes
```

The live check reads only public `/live` and Agent Passport JSON plus a local redacted
process count. It does not store raw IPs, headers, paths, queries, cookies, origins, or
credentials.

A degraded client identity with `enforcementSafe:false` is a WARN, not a burn-in
failure, because that is the known hosting blocker. It keeps enforcement blocked. If
hosting later supplies a trustworthy sanitized client IP, the burn-in checker accepts
that improvement but still reports that the external release gate is required.

## Burn-in evidence

Before v3.0.0 final, collect operational evidence across real production traffic and at
least one controlled restart. Recommended evidence:

- repeated HTTP 200 `/live` checks with RC.2 version,
- unchanged Agent Passport schema/capability set,
- shadow mode continuously true,
- Policy Engine continuously non-enforcing,
- no unexplained application exits or LiteSpeed 503 periods,
- no accumulation of duplicate standalone `app.js` processes,
- successful recovery after a controlled cPanel restart,
- no privacy or authenticated-API regressions,
- full suite, RC hardening, burn-in static gate, release check, and verify all green.

The shared-host worker/thread problem is release-significant. A generic LiteSpeed 503
combined with stale duplicate standalone AnchorWeight `app.js` processes is an
operational failure that must be corrected and explained before final release.

## Feature-freeze rule

RC.2 accepts only release-blocking correctness, security, deployment, compatibility,
documentation, and observability fixes. Any new traffic-defense feature returns to a
post-v3 development line.
