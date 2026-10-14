import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION,ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';
import { createAgentPassport } from '../../src/agent-passport.js';
import { describeAiAgentPolicyManager } from '../../src/ai-agent-policy-manager.js';
import { describeAiAgentPolicyDeployment } from '../../src/ai-agent-policy-deployment.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('beta.1 exposes beta release metadata and AI Controls v8',()=>{
  assert.equal(ANCHORWEIGHT_VERSION,'3.1.0-beta.1');
  assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'beta');
  const p=createAgentPassport({});
  assert.equal(p.capabilities.aiAgentControls.version,8);
  assert.equal(p.capabilities.aiAgentControls.betaReadiness.available,true);
  assert.equal(p.capabilities.aiAgentControls.betaReadiness.enforcementReadinessGranted,false);
});

test('beta.1 preserves policy manager and deployment safety contracts',()=>{
  const m=describeAiAgentPolicyManager();
  const d=describeAiAgentPolicyDeployment();
  assert.equal(m.saveChangesRuntime,false);
  assert.equal(m.enforcementControlAvailable,false);
  assert.equal(m.exportForcesShadowMode,true);
  assert.equal(m.exportForcesEnforcementDisabled,true);
  assert.equal(d.shadowOnlyPreparation,true);
  assert.equal(d.automaticActivation,false);
  assert.equal(d.automaticRestart,false);
  assert.equal(d.enforcementControlAvailable,false);
});

test('dashboard preserves operator surfaces without active enforcement control',()=>{
  const html=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');
  assert.match(html,/AI Agent Policy Manager/);
  assert.match(html,/Controlled AI Policy Deployment/);
  assert.match(html,/PREPARE SHADOW DEPLOYMENT/);
  assert.doesNotMatch(html,/Enable AI Enforcement/);
});

test('release checker wires alpha burn-in and beta stabilization gates',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  assert.match(source,/runAiAgentBurnInCheck/);
  assert.match(source,/runAiAgentBetaCheck/);
  assert.match(source,/AI Agent Burn-In/);
  assert.match(source,/AI Agent Beta Stabilization/);
});
