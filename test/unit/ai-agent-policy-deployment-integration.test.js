import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('alpha.6 dashboard has controlled deployment controls and no enable-enforcement button',()=>{const s=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');assert.match(s,/Controlled AI Policy Deployment/);assert.match(s,/policyDeploymentPrepare/);assert.match(s,/PREPARE SHADOW DEPLOYMENT/);assert.ok(!/Enable AI Enforcement/i.test(s));});
test('alpha.6 runtime API includes authenticated controlled deployment routes',()=>{const s=fs.readFileSync(path.join(root,'src/anchorweight.js'),'utf8');assert.match(s,/createAiAgentPolicyDeployment/);assert.match(s,/policy-deployment\/prepare/);assert.match(s,/policy-deployment\/rollback/);assert.match(s,/validateCsrf/);});
test('alpha.6 deployment documentation explicitly keeps activation and restart external',()=>{const s=fs.readFileSync(path.join(root,'AI-AGENT-POLICY-DEPLOYMENT.md'),'utf8');assert.match(s,/does not edit cPanel/i);assert.match(s,/does not restart/i);assert.match(s,/enforcement.*disabled/i);});
