# AnchorWeight v3.0.0-rc.2 Release Notes

RC.2 is the Production Burn-In release candidate.

## No new traffic-defense features

The RC.1 frozen product contract is preserved unchanged. RC.2 introduces no new
identity signal, scoring dimension, policy action, persistence migration, or
enforcement path.

## Added operational hardening

- `scripts/burn-in-check.js` with static and optional live production validation.
- `test/unit/burn-in-check.test.js` covering feature-freeze, shadow posture, privacy,
  identity gating, version drift, and duplicate worker detection.
- `PRODUCTION-BURN-IN.md` with burn-in and restart acceptance criteria.
- `npm run burnin:check` static release gate.
- release-check integration for the RC.2 static burn-in gate.
- updater verification that `RC1-FROZEN-CONTRACT.json` is byte-for-byte unchanged.

## Known deployment blocker

HawkHost/LiteSpeed currently does not provide the Passenger process with a trustworthy
sanitized original client IP. `clientIdentity.enforcementSafe:false` remains a hard
block on client-scoped enforcement. This does not block shadow-mode RC.2 burn-in.
