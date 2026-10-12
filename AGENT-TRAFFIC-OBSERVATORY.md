# AnchorWeight v3.0.0-alpha.4 — Agent Traffic Observatory

Alpha.4 turns the observation layers from alpha.1-alpha.3 into an operator-facing traffic view.

## Safety boundary

The Agent Traffic Observatory is **observation-only**. It does not throttle, quarantine, redirect, deceive, authenticate, or otherwise alter request handling. Legacy Bot DNA `score` remains the only score-based enforcement source in this alpha line.

## What it summarizes

The authenticated stats surface now aggregates:

- traffic classes (`browser_or_unknown`, `verified_search_crawler`, `declared_ai_crawler`, `user_directed_agent`, `unknown_automation`);
- declared/observed purposes;
- average Automation Confidence, Policy Risk, and Resource Pressure;
- score bands using the existing minimal/low/moderate/high/very-high vocabulary;
- counts of high-confidence automation, policy-concern profiles, and high-pressure profiles;
- bounded top-five lists for each scoring dimension.

## Privacy model

The observatory consumes **public Bot DNA profile projections only**. It does not accept or return raw IP addresses, client keys, User-Agent strings, cookies, raw paths, query strings, route hashes, or cookie hashes. Top lists use the existing anonymized `AW-XXXXXXXX` Bot DNA identifiers.

## Dashboard intent

The dashboard should answer three different questions without conflating them:

1. **How likely is this traffic automated?** — Automation Confidence.
2. **Is it conflicting with explicit site policy or concrete defensive evidence?** — Policy Risk.
3. **How much server pressure is it creating?** — Resource Pressure.

A verified search crawler can therefore be highly automated while remaining low-risk and low-pressure.

## Next step

The next release can introduce operator-configured **Resource Budgets**. Those budgets should consume Resource Pressure and measured traffic cost, but must be explicit, bounded, reversible, and separate from identity alone.

## Beta.3 policy calibration

The authenticated Observatory now includes aggregate Policy Forensics calibration: evaluation count, transition count/rate, high-impact recommendation count, and bounded reason-code frequency. No raw client identifiers or request data are added.
