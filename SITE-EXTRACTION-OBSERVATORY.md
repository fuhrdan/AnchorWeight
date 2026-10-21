# Site Extraction Observatory

AnchorWeight v3.2.0-alpha.2 adds an authenticated aggregate view of the observation-only site-extraction detector.

The observatory reads only the existing sanitized `publicProfile(...).siteExtraction` projection. It does not receive raw paths, raw query strings, cookies, User-Agent strings, client IP addresses, or internal route-family hashes.

## Dashboard

The panel shows:

- profiles observed by the detector;
- profiles active in the last five minutes;
- likely and high-confidence bulk-scrape candidates;
- average and maximum extraction score;
- detector level distribution;
- most common reason codes;
- a bounded ranked candidate table.

Candidate rows contain only the anonymized AnchorWeight Bot DNA ID, detector score/level, request breadth counters, route-family count, 404 percentage, download count, and reason codes.

## Safety boundary

This release is still observation-only.

The observatory cannot:

- block;
- throttle;
- quarantine;
- return decoys;
- mutate legacy Bot DNA score;
- feed Policy Engine inputs;
- feed Resource Budget inputs.

The purpose of alpha.2 is operator review and threshold calibration before any policy simulation is introduced.
