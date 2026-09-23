# AnchorWeight v0.9.0 on cPanel Node.js

AnchorWeight remains zero-runtime-dependency Node.js software. For cPanel deployments, use the **Setup Node.js App** interface rather than Terminal where available.

## Recommended UI setup

1. Upload/extract AnchorWeight into an application directory.
2. In **Setup Node.js App**, create a Node.js 20+ application.
3. Set **Application startup file** to `app.js`.
4. Add environment variables in the cPanel UI. At minimum:
   - `AW_SECRET=<long random persistent value>`
   - `AW_DASHBOARD_TOKEN=<long random admin token>`
   - `AW_PROFILE=production` or `shadow`
   - `AW_ORIGIN_URL=http://127.0.0.1:<origin-port>`
   - `AW_PROXY_ENABLED=true`
   - `AW_ALLOW_QUERY_ADMIN_TOKEN=false`
5. Restart the application from the cPanel UI.
6. Verify `/live`, then `/ready`, then `/dashboard.html`.
7. Run Shadow Mode first when introducing AnchorWeight in front of an existing site.

## Whole-site routing requirement

For Silent Quarantine to protect the entire site, public traffic must pass through AnchorWeight and the real origin must not remain independently reachable from the Internet. Depending on the host, this may require a domain/subdomain mapping or reverse-proxy rule outside the Node.js application itself.

## v0.9 health endpoints

- `/live` — process liveness only.
- `/ready` — readiness and, by default, origin reachability.
- `/health` — compatibility alias for `/live`.

## Shutdown

cPanel restarts normally signal the Node.js process. v0.9.0 handles `SIGTERM`/`SIGINT`, flushes persistent state, stops accepting new connections, and exits after active requests finish or the configured grace deadline is reached.

## v1.2.0 storage option

JSON is still the default and supports existing Node 20+ app configurations.
For SQLite select Node 22.13+ in cPanel, preserve the existing JSON state,
and set `AW_STATE_BACKEND=sqlite`. Follow `SQLITE-MIGRATION.md` first.
