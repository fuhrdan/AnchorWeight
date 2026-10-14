# Verification-Aware AI Policy — v3.1.0-alpha.3

Alpha.3 makes alpha.2 verification usable by the alpha.1 AI-agent access policy without making verification a trust bypass.

## Rule syntax

`AW_AI_AGENT_VERIFICATION_RULES=provider:family@status=action,...`

Statuses: `verified`, `unverified`, `unavailable`, `disabled`. Actions: `allow`, `observe`, `deny`.

Example:

```text
AW_AI_AGENT_VERIFICATION_RULES=openai:oai-searchbot@verified=allow,openai:oai-searchbot@unverified=deny,openai:gptbot@verified=deny
```

## Precedence

1. Exact verification-aware rule, when configured.
2. Existing alpha.1 family override.
3. Existing alpha.1 purpose default.

When verification is unavailable and there is no explicit `@unavailable` rule, AnchorWeight preserves the declaration policy. This keeps request-scoped deny useful behind proxies that cannot provide trusted client identity.

## Safety invariants

- Verified does not automatically mean allow.
- Unverified does not automatically mean deny.
- `allow` never grants trust or bypasses other AnchorWeight defenses.
- `robots.txt` remains readable even when an AI-agent deny would otherwise enforce.
- Provider/family/status rules are exact and bounded.
- No raw client IP, provider CIDR list, path, query, cookie, or credential is exposed by this policy layer.
