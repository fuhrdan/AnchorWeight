# Bot DNA 2.0: operator guide (v1.4.0)

## What changed
The authenticated investigation API and dashboard now distinguish **automation indicators** (e.g. an automation user agent or rapid request burst) from **cryptographic trap evidence** (signed traversal and Proof-of-Crawl), robots-disallowed path observations, and verified search-crawler identity. This assessment is derived from existing profile state; it is **not a new classifier, score, or automatic enforcement policy**. Neither an automated user agent nor a shared network address is evidence of malicious intent.

The investigation JSON has an `assessment` object: `automationObserved`, `automationIndicators`, `trapEvidence`, `identity`, `tlsFingerprint`, and `limitations`. Missing telemetry is marked unavailable; there is no implicit penalty.

## Optional trusted JA4-compatible proxy signal
Default: `AW_TRUSTED_JA4_ENABLED=false`. If a TLS-terminating proxy you control generates JA4-compatible metadata, first ensure the proxy **removes every client-provided X-AW-JA4 value and overwrites it** with its independently measured fingerprint. Only then set:

```env
AW_TRUST_PROXY=true
AW_TRUSTED_JA4_ENABLED=true
```

The app accepts `X-AW-JA4` only when both flags are enabled, hashes the bounded value using AW_SECRET, and retains at most eight hashes per profile. It does not collect or reconstruct JA4 itself, and does not assume the header name is an industry standard. Never enable these flags directly on a public endpoint or behind a proxy that forwards arbitrary client headers. This signal is informational and NEVER adds score or causes quarantine by itself. It is not globally comparable across installations using different secrets. Missing or malformed data is ignored.

## State and rollback
State schema stays at **5**. No migration required; retain your original `AW_SECRET`, `.env`, data, and backup files. Existing profiles without fingerprint data are handled as unavailable. v1.3.0 can read the same state format if you roll back, but any v1.4-only optional fields will simply be ignored by its dashboard. Test in Shadow Mode on the live host before enabling enforcement. The cPanel CommonJS-loading startup hotfix is retained.
