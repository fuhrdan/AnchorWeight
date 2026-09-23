# AnchorWeight v2.1.0 — Declarative Gateway Configuration

This release adds **optional** JSON or restricted YAML gateway configuration and a
route editor in the existing authenticated Setup Wizard. It does **not** enable the
reverse proxy, enable enforcement, or replace existing settings on installation.
The existing single-origin cPanel setup and v1.9 route file keep working unchanged.
There are no additional npm dependencies or storage migrations.

## Fast start on HawkHost

1. Back up and stop the current Node.js application. Overlay v2.1.0 source in the
   existing application root; keep `.git`, `.env`, `data/` and cPanel variables.
2. In Node 22 run `node --test --test-concurrency=1`, then
   `npm run release:verify`. Restart and confirm `/live` reports `2.1.0`.
3. **Only when ready to use unified config**, create
   `data/anchorweight-gateway.json` from the example below. Do this BEFORE
   setting `AW_DECLARATIVE_ENABLED=true`: a missing or invalid enabled file
   deliberately prevents startup rather than silently disabling your protection.
4. Approve each destination in cPanel with `AW_SETUP_ALLOWED_ORIGINS` and
   `AW_ROUTE_ALLOWED_ORIGINS`. Set `AW_SETUP_PUBLIC_HOST` to the public host.
5. If legacy `AW_SETUP_CONFIG_ENABLED` or `AW_ROUTES_ENABLED` is true, migrate
   their values into the new file and turn those TWO flags off. Mixed writers
   are rejected, not silently ordered. All crawler/enforcement/state secrets
   and gateway rate/IP controls continue to come from cPanel.
6. Set `AW_DECLARATIVE_ENABLED=true`. Leave
   `AW_DECLARATIVE_WRITES_ENABLED=false` for the first restart. Validate via
   `node bin/anchorweight.js check`, then restart and test `/ready` and site paths.
7. To use the wizard's **Apply** and **Restore previous configuration** buttons,
   separately enable `AW_DECLARATIVE_WRITES_ENABLED=true` and restart. API writes
   require the existing dashboard token and a CSRF token. The wizard can be
   read-only while file-backed configuration is enabled.

## JSON file example

`data/anchorweight-gateway.json` (private, not checked into Git):

```json
{
  "version": 1,
  "proxy": {
    "enabled": false,
    "defaultOrigin": "http://127.0.0.1:8081/"
  },
  "routes": [
    { "path": "/api", "origin": "http://127.0.0.1:3001/" },
    { "path": "/assets", "origin": "http://127.0.0.1:3002/" }
  ]
}
```

Set `AW_DECLARATIVE_FILE=./data/anchorweight-gateway.json` (the default).
To use YAML, set it to `./data/anchorweight-gateway.yaml`, create that file,
then restart. A YAML example is in `config/examples/gateway-multi.yaml`.

**YAML support deliberately uses a safe, limited subset**, not general YAML:
2-space indented mappings and route lists, full-line comments, JSON-style
quoted strings or simple unquoted strings, booleans, and integer version 1.
No anchors, tags, aliases, multiline scalars, custom types, inline maps or
nonempty inline lists. The writer preserves the chosen file format, and can
also produce the empty-route form `routes: []`. If you need broader YAML
syntax, use JSON instead rather than relying on implicit YAML conversions.

## Safety and precedence

- This configuration controls ONLY `proxy.enabled`, `proxy.defaultOrigin`, and
  `routes`. It does not control credentials, Bot DNA, IP lists, rate limits,
  upstream health, telemetry, alerts, or enforcement. Those remain in cPanel
  for now; subsequent v2.x releases will add validated policy support.
- `AW_DECLARATIVE_ENABLED=false` means none of the above file is applied.
  Legacy environment, named profiles, route files and operator settings keep
  their existing behavior. When true, the approved file is the source of
  truth for the three gateway fields; relevant environment values provide the
  allowlists and baseline origin but do not override the selected destination.
- Default origin must be `AW_ORIGIN_URL` or in `AW_SETUP_ALLOWED_ORIGINS`.
  Every route origin must be in `AW_ROUTE_ALLOWED_ORIGINS`.
  Canonical HTTP/HTTPS origins only: no credentials, paths, queries or fragments.
  The public host may not proxy back to itself. Routes may not take over
  `/live`, `/ready`, `/health`, `/dashboard.html`, `/setup.html`, or `/anchor`.
- File must be inside the application's `data/` directory, end in `.json`,
  `.yaml`, or `.yml`, and be <=32 KiB. Route count <=16. Source uses a
  descriptor-based bounded read and rejects symlinks where supported.
- The wizard validates and builds the proposed routing table before saving a
  replacement file with private 0600 permissions. The prior file is retained
  as `<file>.previous`, also private. The live proxy switches only after the
  replacement succeeds. A failed validation or write leaves the live config
  unchanged. A missing or invalid enabled file prevents startup.
- The operator must explicitly enable the reverse proxy; the gateway controls
  apply only to actual traffic routed through AnchorWeight, and a public origin
  reachable directly may bypass protections. No remote enforcement is added.

## Rollback

**Immediate:** In the wizard, choose **Restore previous configuration**. The
old file is revalidated against the current allowlists before activation.
No automatic retry of unsafe non-idempotent HTTP requests occurs.

**If the wizard is unreachable:** Stop AnchorWeight in cPanel. Back up the
current private file, copy `data/anchorweight-gateway.json.previous` (or YAML
counterpart) back to its configured filename, check with
`node bin/anchorweight.js check`, and restart. Or disable
`AW_DECLARATIVE_ENABLED` and restart to restore the previous environment/
legacy gateway behavior. Do not enable conflicting legacy flags at the same
moment as declarative mode.

**Entire application rollback:** Stop the app, restore your pre-v2.1 backup,
keep the corresponding original cPanel variables, and restart. Never overwrite
live JSON/SQLite state with an old snapshot while the app is running.

## Known limits

- File-backed routing is local to each AnchorWeight process. Each process needs
  its own approved configuration and restart/hot-apply; this is not a cluster
  distribution system.
- Route selection is longest-segment-prefix. No regex, request-controlled
  hosts, wildcard destinations, or arbitrary UI-editable middleware.
- The route editor cannot create approved destinations. That requires cPanel
  configuration by an operator with server access.
- YAML is intentionally restricted so parsing has no third-party runtime
  dependency on HawkHost. For large or unusual YAML documents, use JSON.
