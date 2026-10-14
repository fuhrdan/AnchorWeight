# AnchorWeight v3.1 AI Agent Controls

AnchorWeight v3.1 adds explicit, shadow-first policy controls for declared AI crawlers and user-triggered AI fetchers.

## Design goals

1. Let site operators distinguish model-training crawlers, search/indexing crawlers, user-triggered retrieval agents, and other declared AI automation.
2. Allow a declared agent to be denied even when client IP identity is unavailable. This is request-scoped and stateless: a client can spoof an AI User-Agent only to deny its own request.
3. Never treat a User-Agent declaration as proof of provider ownership. `allow` means only "do not deny because of the AI-agent rule"; it never bypasses AnchorWeight's existing bot, authentication, gateway, or policy controls.
4. Keep the feature shadow-first and explicitly opt-in for enforcement.
5. Keep raw User-Agent strings out of public policy output and logs.

## Providers and families in alpha.1

OpenAI:
- `GPTBot` — model training
- `OAI-SearchBot` — search indexing
- `ChatGPT-User` — user-triggered retrieval
- `OAI-AdsBot` — general declared automation / ads validation

Anthropic:
- `ClaudeBot` — model training
- `Claude-SearchBot` — search indexing
- `Claude-User` — user-triggered retrieval

Perplexity:
- `PerplexityBot` — search indexing
- `Perplexity-User` — user-triggered retrieval

Google:
- `Google-Agent` — user-triggered agent navigation/action
- `Google-GeminiNotebook` — user-triggered Gemini Notebook retrieval
- `Google-NotebookLM` — legacy alias mapped to the Gemini Notebook family
- `Google-CloudVertexBot` — declared Google/Vertex automation
- `Google-Extended` — robots.txt product token only; it has no dedicated HTTP User-Agent

## Configuration

All defaults are observation-only and preserve v3.0 behavior.

```text
AW_AI_AGENT_POLICY_ENABLED=true
AW_AI_AGENT_POLICY_SHADOW_MODE=true
AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=false
AW_AI_AGENT_TRAINING_ACTION=observe
AW_AI_AGENT_SEARCH_ACTION=observe
AW_AI_AGENT_USER_ACTION=observe
AW_AI_AGENT_AUTOMATION_ACTION=observe
AW_AI_AGENT_FAMILY_RULES=
```

Valid actions are `allow`, `observe`, and `deny`.

Family overrides use comma-separated `provider:family=action` entries, for example:

```text
AW_AI_AGENT_FAMILY_RULES=openai:gptbot=deny,openai:oai-searchbot=allow,openai:chatgpt-user=deny
```

Family overrides win over purpose defaults.

## Example: allow AI search, deny training and direct AI retrieval

```text
AW_AI_AGENT_TRAINING_ACTION=deny
AW_AI_AGENT_SEARCH_ACTION=allow
AW_AI_AGENT_USER_ACTION=deny
AW_AI_AGENT_AUTOMATION_ACTION=observe
AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=true
AW_AI_AGENT_POLICY_SHADOW_MODE=false
```

This does **not** enable AnchorWeight's client-scoped Policy Engine or legacy score enforcement. It only enables the declared AI-agent request gate.

## robots.txt guidance

Generate suggested AI-agent directives with:

```bash
npm run ai-agents:robots
```

Merge the output with your existing `robots.txt`; do not replace unrelated search-crawler rules.

`Google-Extended` is handled only through robots guidance because Google documents it as a product token rather than a distinct HTTP User-Agent. Blocking `Google-Extended` must not be implemented as a blanket block on `Googlebot`.

## Runtime behavior

For a matching request AnchorWeight resolves:

`declared identity -> family override -> purpose default -> allow / observe / deny`

A `deny` becomes an HTTP 403 only when both are true:

```text
AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=true
AW_AI_AGENT_POLICY_SHADOW_MODE=false
```

`/robots.txt` remains reachable even by an otherwise denied declared agent so compliant crawlers can learn the site's policy.

## Trust and verification

Alpha.1 is declaration-aware, not provider-authenticated. OpenAI and Perplexity publish IP ranges; Google publishes crawler/fetcher IP ranges and has begun documenting Web Bot Auth; Anthropic currently documents its bots but does not publish stable IP ranges. Provider/network verification is a separate future v3.1 milestone.

The safety rule in alpha.1 is asymmetric:

- declared identity may justify **self-denial**;
- declared identity may **not** grant trust, allowlisting, or bypass privileges.

## Operator checks

```bash
npm run ai-agents:check
npm run ai-agents:robots
```

The first command verifies identity mappings, deny semantics, shadow behavior, robots guidance, Agent Passport publication, privacy invariants, and runtime preflight wiring.

## Vendor references reviewed for alpha.1

- OpenAI crawler documentation: https://developers.openai.com/api/docs/bots
- Anthropic crawler documentation: https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
- Google crawling infrastructure: https://developers.google.com/crawling
- Google user-triggered fetchers: https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers
- Perplexity crawler documentation: https://docs.perplexity.ai/docs/resources/perplexity-crawlers

Vendor identities and behavior can change. Update the catalog only from current vendor documentation and keep new identities shadowed until tested.

## Alpha.2 verification

Alpha.2 adds a second identity state beside the declared User-Agent: provider-published network verification. See VERIFIED-AI-AGENTS.md. Declared deny remains independent from verification; verified allow still does not grant trust.


<!-- v3.1-alpha.3 verification-aware-policy -->
## v3.1 alpha.3 — verification-aware AI policy

Exact verification-status overrides are configured with `AW_AI_AGENT_VERIFICATION_RULES`, using `provider:family@status=allow|observe|deny`. If no exact rule matches, AnchorWeight preserves the alpha.1 declaration policy; verified identity never grants trust. See `VERIFICATION-AWARE-AI-POLICY.md`.
