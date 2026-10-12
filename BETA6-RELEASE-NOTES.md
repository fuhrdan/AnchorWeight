# AnchorWeight v3.0.0-beta.6 — Proxy Identity Diagnostics

Beta.6 is a diagnostics/release-hardening beta. It does not expand enforcement.

## Added

- Privacy-safe `clientIdentity.diagnostics` on existing runtime snapshots.
- Explicit verdicts for missing/invalid trusted proxy client identity.
- Bounded forwarded-header observation counters without raw values.
- Dashboard Proxy Identity Diagnostics panel.
- Release Readiness uses the diagnostic remediation when identity blocks enforcement.
- Installation doctor explains proxy-trust configuration and points operators at runtime diagnostics.
- Agent Passport advertises the diagnostics capability and its privacy posture.
- `PROXY-IDENTITY-DIAGNOSTICS.md` and focused unit coverage.

## Current HawkHost expectation

With `AW_TRUST_PROXY=true` and no server-generated `X-Forwarded-For`, beta.6 should report:

- `status: degraded`
- `reason: trusted_proxy_client_ip_unavailable`
- `enforcementSafe: false`
- `diagnostics.verdict: trusted_proxy_missing_client_ip`
- `diagnostics.remediationCode: hosting_proxy_must_supply_sanitized_x_forwarded_for`

This is an expected blocked state, not a product failure.
