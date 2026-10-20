# Site Extraction / Bulk Scrape Detection — v3.2.0-alpha.1

AnchorWeight v3.2 begins with an observation-only detector for clients attempting to enumerate or copy a large portion of a public website.

## Design goal

The detector does **not** try to answer:

> "Is this request from curl?"

A command-line User-Agent is weak evidence and is easy to spoof. Instead, AnchorWeight asks:

> "Is this client behaving like it is systematically extracting the site?"

## Evidence

The detector combines bounded, explainable signals such as:

- unique URL breadth per minute;
- five-minute route breadth;
- the ratio of unique URLs to requests;
- repeated traversal of many URLs that normalize to a small number of route families;
- numeric resource enumeration;
- very low cookie continuity;
- document-heavy collection with few asset requests;
- absence of normal browser Fetch Metadata as supporting evidence only;
- regular machine-like timing;
- repeated command-line client declarations as supporting evidence only;
- 404-heavy enumeration;
- bulk download responses/bytes.

No one signal is sufficient by itself.

A single `curl` request is deliberately below the detector's watch threshold.

## Levels

- `none`
- `watch`
- `elevated`
- `likely_bulk_scrape`
- `high_confidence_bulk_scrape`

The v3.2 alpha.1 threshold for `likely_bulk_scrape` is 60/100 and high confidence is 80/100.

## Privacy

The detector stores bounded counters and keyed hashes of normalized route families.

It does **not** retain:

- raw paths;
- raw query strings;
- raw cookies;
- raw User-Agent values.

## Enforcement

v3.2.0-alpha.1 is observation-only.

It does not:

- mutate the legacy Bot DNA score;
- add Policy Risk points;
- add Resource Pressure points;
- change Resource Budget inputs;
- call the Policy Engine;
- throttle;
- decoy;
- quarantine;
- deny a request.

This separation is intentional. We first need production evidence showing that the detector distinguishes bulk extraction from normal browsing, search crawling, APIs, feed readers, accessibility tools, and other legitimate high-breadth clients.

## Why this matters

A public page cannot be made impossible to download. The defensive objective is to make systematic extraction visible and policy-controllable regardless of whether the collector uses curl, Python, Playwright, a browser, or an AI agent.

Future v3.2 work can add bounded observability, tuning, policy simulation, and eventually an explicitly gated enforcement bridge after false-positive review.
