# Verified AI-Agent Identity — v3.1 alpha.2

AnchorWeight v3.1.0-alpha.2 separates **declared identity** from **verified network identity**.

## Verification sources

- OpenAI: family-specific published CIDR feeds for GPTBot, OAI-SearchBot, ChatGPT-User, and OAI-AdsBot.
- Perplexity: family-specific published CIDR feeds for PerplexityBot and Perplexity-User.
- Google: published CIDR feeds for user-triggered agents, Google-controlled user-triggered fetchers, and common crawlers.
- Anthropic: declared identity only. Anthropic currently states that it does not publish crawler IP ranges.

Google is experimenting with Web Bot Auth for some AI-agent traffic. Alpha.2 documents that path but does **not** claim cryptographic Web Bot Auth verification; published network ranges remain the implemented Google verification mechanism.

## Safety properties

Verification never grants an AnchorWeight trust bypass. A verified result means only that the trusted client IP reaching AnchorWeight belongs to a provider-published network range appropriate for that agent family/category.

Alpha.1 request-scoped `deny` remains independent of verification, so a site may still deny a request that declares itself as a blocked AI agent even when the hosting proxy cannot provide a trustworthy client IP.

If client identity is degraded, verification reports `unavailable / trusted_client_identity_required`; it never guesses.

## Configuration

```text
AW_AI_AGENT_VERIFICATION_ENABLED=true
AW_AI_AGENT_VERIFICATION_CACHE_MINUTES=360
AW_AI_AGENT_VERIFICATION_TIMEOUT_MS=1500
```

Provider range documents are cached in-process. Fetch failures, malformed feeds, timeouts, range mismatches, and unsupported providers fail safely without promoting a request to verified status.

## Provider references

- OpenAI crawler documentation: https://developers.openai.com/api/docs/bots
- OpenAI family CIDR feeds:
  - https://openai.com/gptbot.json
  - https://openai.com/searchbot.json
  - https://openai.com/chatgpt-user.json
  - https://openai.com/adsbot.json
- Perplexity crawler documentation: https://docs.perplexity.ai/guides/bots
- Perplexity CIDR feeds:
  - https://www.perplexity.com/perplexitybot.json
  - https://www.perplexity.com/perplexity-user.json
- Google verification guidance: https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests
- Google user-triggered fetchers: https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers
- Google Web Bot Auth (experimental): https://developers.google.com/crawling/docs/crawlers-fetchers/web-bot-auth
- Anthropic crawler guidance: https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler


<!-- v3.1-alpha.3 verification-aware-policy -->
## v3.1 alpha.3 — verification-aware AI policy

Exact verification-status overrides are configured with `AW_AI_AGENT_VERIFICATION_RULES`, using `provider:family@status=allow|observe|deny`. If no exact rule matches, AnchorWeight preserves the alpha.1 declaration policy; verified identity never grants trust. See `VERIFICATION-AWARE-AI-POLICY.md`.
