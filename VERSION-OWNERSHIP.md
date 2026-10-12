# Runtime Version Ownership

Starting with v3.0.0-beta.5, runtime JavaScript should use `src/version.js` as the authoritative application-version source.

The package and lockfile retain their normal package-manager version fields. `scripts/release-check.js` verifies that both match `ANCHORWEIGHT_VERSION` and also verifies that the CLI `version` command returns that exact value.

The centralization covers the primary server, operator API, Agent Passport, CLI, intelligence hub, audit log metadata, persistence metadata, evidence exports, investigation reports, and operator diagnostics. Static dashboard HTML receives the version from `app.js` through the `__AW_VERSION__` placeholder.
