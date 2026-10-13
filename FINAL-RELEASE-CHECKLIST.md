# AnchorWeight v3.0.0 Final Release Checklist

v3.0.0 graduates RC.2 after production burn-in. The final release does not add product features.

## Pre-final RC.2 gate

Before applying the final updater, run the RC.2 live burn-in check against production and confirm PASS. A warning for `trusted_proxy_client_ip_unavailable` is expected while enforcement remains blocked.

## Final source gates

With AnchorWeight stopped in cPanel and stale AnchorWeight workers cleared:

```bash
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" node scripts/test-suite.js
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run rc:check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run burnin:check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run final:check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm run security:check
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" node scripts/release-check.js
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" node scripts/release-check.js --verify
```

Every gate must pass before commit/tag/deployment.

## Deployment acceptance

After deploying `v3.0.0`:

```bash
curl -i https://newlands-games.com/live
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" node scripts/burn-in-check.js --url https://newlands-games.com --local-processes
```

Required initial posture: HTTP 200, version `3.0.0`, `shadowMode:true`, `proxyEnabled:true`. The current HawkHost identity limitation may warn and must keep `enforcementSafe:false` until the hosting proxy is corrected.

## Rollback

The final release contains no persistence migration. If release-blocking behavior appears, stop production, return code to `v3.0.0-rc.2`, clear only stale AnchorWeight workers, run the RC.2 suite, and restart through cPanel.
