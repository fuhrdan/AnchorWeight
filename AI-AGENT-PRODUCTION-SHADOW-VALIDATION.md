# AnchorWeight v3.1 Production Shadow Validation

v3.1.0-beta.2 validates the deployed operating workflow while keeping active AI-agent deny enforcement disabled.

Beta.2 adds no new request-enforcement behavior.

## 1. Offline beta.2 gate

Before deployment:

```sh
npm run ai-agents:beta2-check
```

A passing result ends with:

```text
READY FOR PRODUCTION SHADOW VALIDATION
```

## 2. Deploy beta.2 in shadow mode

The live instance must report:

- `version: 3.1.0-beta.2`
- `shadowMode: true`
- `enforcement.aiAgentPolicyEnforced: false` in the Agent Passport

Do not enable AI-agent deny enforcement during beta.2.

## 3. Public production validation

Set the production URL:

```sh
export AW_PRODUCTION_CHECK_URL="https://example.com"
npm run ai-agents:production-check
```

The validator performs only GET requests. It checks:

- `/live`
- `/.well-known/anchorweight`
- `/robots.txt`
- one normal browser canary
- all 12 declared AI-agent families

While enforcement is disabled, none of those AI canaries should receive HTTP 403 from the AI policy gate.

## 4. Authenticated operator validation

For full operator/API checks, place the dashboard token in an environment variable:

```sh
export AW_PRODUCTION_DASHBOARD_TOKEN='...'
npm run ai-agents:production-check
```

The validator intentionally rejects a `--token` command-line option so the dashboard credential is not placed in shell history or process arguments.

Authenticated checks cover:

- `${basePath}/api/stats`
- `${basePath}/api/ai-agents`
- `${basePath}/api/ai-agents/policy-manager`
- `${basePath}/api/ai-agents/policy-deployment`

The validator checks those AI surfaces for forbidden raw request/credential keys and verifies that policy management/deployment still expose no enforcement control.

## 5. Manual restart persistence drill

Capture a redacted baseline before restarting Passenger/Node:

```sh
npm run ai-agents:production-check -- --capture data/beta2-production-before.json
```

Restart the application manually through the hosting control plane. The script never restarts it for you.

Then compare:

```sh
npm run ai-agents:production-check -- --compare data/beta2-production-before.json
```

The comparison checks persistence of:

- deployed version/base path;
- policy-manager saved-draft status;
- prepared deployment state;
- rollback availability;
- prepared plan ID when present.

The observability counter is captured for operator context but is not required to persist because alpha.4 observability is explicitly process-local and reset-on-restart.

## HawkHost client identity

`clientIdentity.status=degraded` with `enforcementSafe=false` is reported as a warning rather than misrepresented as a successful identity proof. Provider-network verification and client-scoped enforcement remain constrained until the hosting boundary supplies a trustworthy sanitized client identity.

## RC review

A public-only PASS means the deployed shadow path behaved safely.

`READY FOR v3.1 RC REVIEW` requires authenticated operator checks **and** a successful post-restart comparison. A live check without the restart drill can pass production-shadow validation but cannot claim RC-review completeness.

Even an RC-review verdict does **not** grant enforcement readiness or enable deny enforcement.


## beta.2-fix2 validator clarification

AnchorWeight does not create or serve `/robots.txt`. The `ai-agents:robots` command only prints suggested directives for an operator to merge into an existing robots file.

Production validation therefore requests `/robots.txt` using `GPTBot/1.4` and treats an origin HTTP 404 as acceptable pass-through. HTTP 403 remains a failure because AI policy denied crawler discovery, and HTTP 5xx remains a server-side failure.
