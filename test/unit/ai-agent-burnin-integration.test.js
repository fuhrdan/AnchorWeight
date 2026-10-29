import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION } from '../../src/version.js';
import { createAgentPassport } from '../../src/agent-passport.js';
import { describeAiAgentPolicyManager } from '../../src/ai-agent-policy-manager.js';
import { describeAiAgentPolicyDeployment } from '../../src/ai-agent-policy-deployment.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('v3.1 burn-in readiness remains available under the current v3 release',()=>{
  assert.match(ANCHORWEIGHT_VERSION,/^3\./);
  const p=createAgentPassport({});
  assert.equal(p.capabilities.aiAgentControls.version,11);
  assert.equal(p.capabilities.aiAgentControls.burnInReadiness.available,true);
  assert.equal(p.capabilities.aiAgentControls.burnInReadiness.enforcementReadinessGranted,false);
  assert.equal(p.capabilities.aiAgentControls.burnInReadiness.enforcementControlAvailable,false);
});

test('observability, manager and deployment retain non-enforcing contracts',()=>{
  const p=createAgentPassport({});
  const o=p.capabilities.aiAgentControls.observability;
  const m=describeAiAgentPolicyManager();
  const d=describeAiAgentPolicyDeployment();
  assert.equal(o.enforcement,false);
  assert.equal(m.enforcementControlAvailable,false);
  assert.equal(m.saveChangesRuntime,false);
  assert.equal(d.shadowOnlyPreparation,true);
  assert.equal(d.automaticActivation,false);
  assert.equal(d.automaticRestart,false);
  assert.equal(d.enforcementControlAvailable,false);
});

test('dashboard retains all AI operator surfaces without enforcement enable control',()=>{
  const html=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');
  assert.match(html,/AI Agent Policy Manager/);
  assert.match(html,/Controlled AI Policy Deployment/);
  assert.match(html,/PREPARE SHADOW DEPLOYMENT/);
  assert.doesNotMatch(html,/Enable AI Enforcement/);
});

test('release checker wires the alpha.7 burn-in gate',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  assert.match(source,/runAiAgentBurnInCheck/);
  assert.match(source,/AI Agent Burn-In/);
});
