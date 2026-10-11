# Agent Identity 1.0 — v3.0-alpha.1

AnchorWeight 3.0-alpha.1 introduces an **observation-only traffic identity taxonomy** for the increasingly mixed human, crawler, and agent traffic reaching protected sites.

## Safety boundary

Agent Identity does **not** add risk points, quarantine a client, change gateway policy, or trigger adaptive intervention. It records what the request appears to be and keeps that evidence separate from AnchorWeight's existing behavioral risk score.

A User-Agent is a claim, not proof. A request that says `GPTBot`, `ChatGPT-User`, `ClaudeBot`, or another recognized token is classified with confidence `declared`. Only AnchorWeight's existing verified-good-bot path can produce confidence `verified`.

## Traffic classes

- `browser_or_unknown` — no agent declaration or generic automation indicator was observed. This is **not** proof that the client is human.
- `verified_search_crawler` — existing good-bot verification independently established a recognized search crawler.
- `declared_ai_crawler` — a published AI crawler/search User-Agent token was observed, but provider ownership has not been independently verified.
- `user_directed_agent` — a published User-Agent for an action initiated by an end user was observed.
- `unknown_automation` — generic automation software was observed but no supported provider/purpose declaration was recognized.

## Purposes

The alpha records one of: `model_training`, `search_indexing`, `user_retrieval`, `general_automation`, or `unknown`.

The initial catalog recognizes the published OpenAI tokens `GPTBot`, `OAI-SearchBot`, and `ChatGPT-User`, plus Anthropic's `ClaudeBot`, `Claude-SearchBot`, and `Claude-User`. The catalog is intentionally conservative and will expand only when provider documentation is sufficiently clear.

## Privacy and retention

AnchorWeight does not persist the raw User-Agent in Agent Identity history. It stores normalized provider/family/purpose fields and bounded evidence labels. Identity history is capped at eight transitions per Bot DNA profile.

## Public Bot DNA projection

Profiles gain an `agentIdentity` object similar to:

```json
{
  "declared": true,
  "trafficClass": "user_directed_agent",
  "provider": "openai",
  "family": "chatgpt-user",
  "purpose": "user_retrieval",
  "confidence": "declared",
  "source": "user_agent",
  "evidence": ["declared_user_agent:chatgpt-user"],
  "observations": 12,
  "lastAt": 1791640800000,
  "history": []
}
```

The existing `classification`, `score`, `assessment`, manual policy, Proof-of-Crawl, and quarantine semantics remain unchanged in this alpha.

## Next planned step

v3.0-alpha.2 is intended to add session-level Agent Behavior metrics (route breadth, navigation depth, request cadence, retries, nonexistent-route probing, continuity, and related explainable observations) without collapsing identity and risk into one score.
