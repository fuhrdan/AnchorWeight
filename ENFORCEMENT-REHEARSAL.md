# Enforcement Rehearsal — v3.0.0-beta.7

AnchorWeight beta.7 adds an authenticated, advisory-only rehearsal report for the existing shadow-first Policy Engine.

## Purpose

Before a controlled enforcement trial, an operator needs to know whether current policy recommendations are stable and whether high-impact recommendations conflict with analyst-reviewed false positives. Beta.7 answers that question without changing thresholds, configuration, profile state, blocks, responses, or routing.

The report is available in the dashboard, the authenticated stats payload, and:

`GET <basePath>/api/policy/rehearsal`

## What it summarizes

- Policy evaluation counts accumulated by bounded Policy Forensics.
- ALLOW / OBSERVE / BUDGET / THROTTLE / DECOY / QUARANTINE recommendation counts.
- Current action posture across sampled public Bot DNA profiles.
- Bounded decision transitions seen in the most recent 24-hour window.
- Analyst labels (`false_positive`, `confirmed_automation`).
- False-positive profiles currently receiving THROTTLE, DECOY, or QUARANTINE recommendations.
- Confirmed automation currently receiving ALLOW, reported as informational because automation alone does not imply abuse.

## Verdicts

- `collecting`: more shadow evaluations, analyst labels, or lower intervention rate are needed.
- `review_required`: at least one analyst-reviewed false positive currently receives a high-impact recommendation.
- `clear_for_controlled_trial_review`: rehearsal evidence is sufficient and no current false-positive high-impact conflict is present.

`clear_for_controlled_trial_review` is **not** permission to enable enforcement. Trusted client identity, the external test/release gate, operator review, and a limited trial plan remain separate requirements.

## Privacy and safety

The rehearsal analyzer consumes bounded public projections only. It does not expose raw IPs, headers, paths, queries, cookies, credentials, or origin URLs. It never changes enforcement and does not create a new enforcement path.
