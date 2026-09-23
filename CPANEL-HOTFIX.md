# AnchorWeight v1.2.0 cPanel startup compatibility hotfix

Some cPanel/Passenger Node.js loaders import the startup module via `require()`.
The original v1.2.0 app.js introduced top-level await, which Node.js 22 can reject as ERR_REQUIRE_ASYNC_MODULE when loaded by require().
This hotfix moves initialization into an async main() function and removes top-level await.

If your cPanel application became unavailable following v1.2.0 installation:
1. Back up the original app.js, data directory and environment settings.
2. Overwrite only app.js with the patched app.js provided in this release.
3. Keep AW_STATE_BACKEND=json and preserve AW_STATE_FILE and AW_SECRET.
4. Restart the existing Node.js application. Do not delete and recreate it.
5. Check /live for version 1.2.0 and /ready for origin readiness, then refresh dashboard.
6. If still 503, inspect the cPanel application log for ERR_REQUIRE_ASYNC_MODULE and other startup failures.

This patch addresses one confirmed module-loader compatibility issue; it does not prove that every HTTP 503 has that cause.
