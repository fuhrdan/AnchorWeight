# AnchorWeight v3.0.0-alpha.6 — Client Environment 2.0 / Headless Consistency

Alpha.6 extends AnchorWeight's privacy-minimized client-environment observation with browser automation and display-topology consistency signals.

## New observations

- `navigator.webdriver` when the browser exposes it.
- `screen.isExtended` when the browser exposes it.
- availability of `window.getScreenDetails` **without calling it**.
- bounded `navigator.hardwareConcurrency` and `navigator.maxTouchPoints` context.

AnchorWeight does **not** request the Window Management permission and does not enumerate physical screens. `screen.isExtended` can tell us that an extended multi-screen environment is reported, but it does not provide an exact monitor count.

## Enforcement boundary

Headless Consistency is observation-only in alpha.6. A positive `navigator.webdriver` observation can raise the v3 **Automation Confidence** dimension because it is direct browser automation evidence, but it does not add legacy Bot DNA points, Policy Risk, Resource Pressure, or independently trigger quarantine.

Odd screen geometry remains supporting evidence rather than proof. Real users can legitimately run VMs, remote desktops, kiosks, unusual DPI settings, accessibility configurations, or single-monitor systems.

## Privacy

No raw IP address, full User-Agent, cookie, path, query, physical monitor details, screen labels, or permission-gated screen enumeration is collected by Client Environment 2.0.
