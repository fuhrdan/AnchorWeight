import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';
import { createAgentPassport } from '../../src/agent-passport.js';
import { runFinalReleaseCheck } from '../../scripts/final-release-check.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const contract=JSON.parse(fs.readFileSync(path.join(root,'RC1-FROZEN-CONTRACT.json'),'utf8'));
const config={basePath:'/anchor',shadowMode:true,scoreEnforcementEnabled:false,policyEngineEnabled:true,policyEngineEnforcementEnabled:false,policyEngineShadowMode:true};

test('v3.0.0 final uses stable release metadata',()=>{
  assert.equal(ANCHORWEIGHT_VERSION,'3.0.0');
  assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'stable');
});

test('v3.0.0 final preserves the frozen Agent Passport capability contract',()=>{
  const passport=createAgentPassport(config);
  assert.deepEqual(Object.keys(passport.capabilities||{}).sort(),[...contract.capabilities].sort());
  assert.deepEqual(passport.capabilities.policyEngine.actions,contract.policyActions);
});

test('v3.0.0 final remains shadow-first by default',()=>{
  const passport=createAgentPassport(config);
  for(const [key,value] of Object.entries(contract.enforcementDefaults))assert.equal(passport.enforcement[key],value,key);
});

test('v3.0.0 final preserves privacy false flags',()=>{
  const passport=createAgentPassport(config);
  for(const key of contract.privacyFalseFlags)assert.equal(passport.privacy[key],false,key);
});

test('v3.0.0 final release gate composes hardening and burn-in checks',()=>{
  const result=runFinalReleaseCheck({root});
  assert.equal(result.ok,true,result.failures.join('\n'));
  assert.ok(result.checks>=20);
  assert.ok(result.hardeningChecks>=40);
  assert.ok(result.burnInChecks>=30);
});
