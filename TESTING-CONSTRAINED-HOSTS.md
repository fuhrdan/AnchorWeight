# Testing on constrained hosts

AnchorWeight's full suite includes integration tests that intentionally launch real Node child processes. Shared hosting can impose strict per-user process/thread limits.

## Hotfix 5 strategy

`npm test` now uses `scripts/test-suite.js`. Normal environments retain Node's process-isolated test runner. When both `UV_THREADPOOL_SIZE=1` and `NODE_OPTIONS=--v8-pool-size=1` are present (or `AW_TEST_CONSTRAINED=true` is set), test files that themselves use `node:child_process` are loaded directly with Node 22+ `isolation: 'none'`. This removes one test-runner worker process while preserving the real child AnchorWeight process exercised by those tests.

No EAGAIN/pthread failure is converted to a skip. A resource failure remains a test failure. Green means green.

Recommended HawkHost command:

```bash
UV_THREADPOOL_SIZE=1 NODE_OPTIONS="--v8-pool-size=1" npm test
```

To force the old process-isolated runner: `npm run test:process-isolated`. To force constrained mode explicitly: `AW_TEST_CONSTRAINED=true npm test`.


<!-- beta2-hotfix6-operator-env -->
## Operator-experience subprocess fixtures

The operator-experience integration and unit fixtures intentionally scrub inherited environment variables so production `AW_*` settings cannot affect the test. On constrained hosts they preserve only `UV_THREADPOOL_SIZE` and `NODE_OPTIONS` from the parent test process. This keeps child CLI/server processes within the same host resource envelope without inheriting AnchorWeight production policy. Timeouts, startup failures, and assertion failures remain real test failures; they are never converted to skips.
