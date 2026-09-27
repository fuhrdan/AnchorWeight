# AnchorWeight v2.7.0 — Client Environment Consistency

This update adds privacy-minimized display consistency evidence as a supporting Bot DNA signal.

Collected values are limited to screen width/height, available width/height, viewport width/height,
device pixel ratio, color depth, and orientation. AnchorWeight does not collect canvas, fonts,
installed devices, WebGL renderer strings, or other high-entropy fingerprinting surfaces.

The server stores a keyed 16-hex display fingerprint plus bounded explainable anomaly reasons.
Raw IP addresses remain outside the profile. Unusual resolutions receive only low weight. Missing
screen APIs are not treated as proof of automation.

Signals include impossible dimensions, available area larger than screen, a materially oversized
viewport, invalid DPR, orientation/dimension contradiction, and repeated fingerprint changes.
Existing `AW_SCORE_ENFORCEMENT_ENABLED=false` remains the safe default.

Roll out in Shadow Mode first and review legitimate traffic before enabling score enforcement.
