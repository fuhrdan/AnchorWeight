# AnchorWeight v3.0.0-rc.1 Release Notes

RC.1 begins the v3 feature freeze and release-candidate hardening phase.

## Runtime behavior

RC.1 intentionally adds no traffic-defense feature. The beta.7 production feature
surface is frozen. Application behavior remains shadow-first and the trusted-client-
identity enforcement gate remains mandatory.

## Added release tooling

- `RC1-FROZEN-CONTRACT.json` — machine-readable frozen v3 contract.
- `scripts/rc-hardening-check.js` — validates frozen capability/privacy/safety invariants.
- `test/unit/rc-hardening.test.js` — regression coverage for the RC contract.
- `RELEASE-CANDIDATE-HARDENING.md` — install/upgrade/rollback/security procedures.
- `npm run rc:check` — explicit RC hardening gate.
- normal `scripts/release-check.js` also invokes the RC hardening gate for RC builds.

Version: `3.0.0-rc.1`; release channel: `rc`.

Known blocker: HawkHost/LiteSpeed currently does not provide a sanitized original client
IP to Passenger, so Proxy Identity Diagnostics must remain degraded and
`enforcementSafe:false`. RC.1 is for shadow-mode burn-in, not an enforcement trial.
