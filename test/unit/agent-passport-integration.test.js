import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentPassport } from '../../src/agent-passport.js';

test('passport posture is descriptive and cannot create a new enforcement path',()=>{
  const p=createAgentPassport({shadowMode:false,scoreEnforcementEnabled:true});
  assert.equal(p.enforcement.legacyScoreEnforcementEnabled,true);
  assert.equal(p.enforcement.trafficDimensionsEnforced,false);
  assert.equal(p.enforcement.resourceBudgetsAvailable,true);
  assert.equal(p.enforcement.resourceBudgetsEnforced,false);
  assert.equal(p.enforcement.policyEngineAvailable,true);
  assert.equal(p.enforcement.policyEngineEnforced,false);
});
