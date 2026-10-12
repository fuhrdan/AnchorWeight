# AnchorWeight v3.0.0-beta.6 — Proxy Identity Diagnostics

Beta.6 makes reverse-proxy client identity failures explainable without weakening AnchorWeight's trust boundary.

## What it reports

`clientIdentity.diagnostics` is available anywhere the existing client identity snapshot is returned, including `/live`, `/ready`, and the authenticated stats API. The dashboard renders the same safe diagnostic state.

Diagnostics include only booleans, bounded counters, a verdict, and an operator remediation code:

- whether proxy hints were observed;
- whether the socket looked like an internal proxy hop;
- whether `X-Forwarded-For` was absent, present/valid, or present/invalid;
- counts of valid/invalid/missing observations;
- whether a hosting-layer change is required;
- a safe operator action string.

AnchorWeight does **not** expose the raw client IP or raw forwarded-header value in the diagnostic snapshot.

## Common verdicts

### `trusted_proxy_missing_client_ip`

`AW_TRUST_PROXY=true`, but Passenger/LiteSpeed is not supplying a usable `X-Forwarded-For` value. Client-scoped enforcement remains blocked. The hosting proxy must overwrite client-supplied forwarding headers and provide a server-generated original client IP.

### `trusted_proxy_invalid_client_ip`

Trusted proxy mode is enabled, but the forwarded client value is not a valid IP address. Client-scoped enforcement remains blocked.

### `proxy_detected_trust_disabled`

A local reverse proxy is detected while `AW_TRUST_PROXY=false`. This is safe. Verify server-side sanitization before enabling proxy trust.

### `trusted_client_identity`

A trusted client identity is available. This removes the client-identity blocker, but it does **not** by itself enable enforcement. Global shadow, Policy Engine shadow, explicit enforcement opt-in, calibration, and release gates remain independent.

## Safety properties

Beta.6 does not:

- trust `X-Real-IP`, `CF-Connecting-IP`, `Forwarded`, or other alternate headers as a fallback;
- automatically enable `AW_TRUST_PROXY`;
- bypass degraded-identity enforcement suppression;
- expose raw IP/header values in diagnostics;
- change Policy Engine thresholds or enforcement defaults.

