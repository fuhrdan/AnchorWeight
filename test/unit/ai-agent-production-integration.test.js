import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION,ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';
import { createAgentPassport } from '../../src/agent-passport.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('beta.2 publishes production validation capability without enforcement authority',()=>{
  assert.equal(ANCHORWEIGHT_VERSION,'3.1.0');
  assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'stable');
  const p=createAgentPassport({});
  assert.equal(p.capabilities.aiAgentControls.version,11);
  assert.equal(p.capabilities.aiAgentControls.productionValidation.available,true);
  assert.equal(p.capabilities.aiAgentControls.productionValidation.enforcementReadinessGranted,false);
  assert.equal(p.capabilities.aiAgentControls.productionValidation.enforcementControlAvailable,false);
});

test('production validator uses environment token and rejects command-line token design',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/ai-agent-production-check.js'),'utf8');
  assert.match(source,/AW_PRODUCTION_DASHBOARD_TOKEN/);
  assert.match(source,/Do not pass dashboard tokens on the command line/);
  assert.match(source,/AW_PRODUCTION_CHECK_URL/);
});

test('production validator covers public, authenticated and restart-comparison paths',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/ai-agent-production-check.js'),'utf8');
  assert.match(source,/\/robots\.txt/);
  assert.match(source,/\.well-known\/anchorweight/);
  assert.match(source,/\/api\/stats/);
  assert.match(source,/\/api\/ai-agents\/policy-manager/);
  assert.match(source,/\/api\/ai-agents\/policy-deployment/);
  assert.match(source,/--capture/);
  assert.match(source,/--compare/);
});

test('beta.2 release check remains source-only while production check stays explicit',()=>{
  const release=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  assert.match(release,/runAiAgentBeta2Check/);
  assert.doesNotMatch(release,/runAiAgentProductionCheck/);
});
