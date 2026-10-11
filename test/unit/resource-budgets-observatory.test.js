import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTrafficObservatory } from '../../src/agent-observatory.js';

function p(id,status,utilization,pressure=10){
  return {
    id,
    requestCount:5,
    score:0,
    agentIdentity:{trafficClass:'browser_or_unknown',purpose:'unknown'},
    trafficScores:{automationConfidence:{score:0},policyRisk:{score:0},resourcePressure:{score:pressure}},
    resourceBudget:{status,utilization:{requestsPerMinute:utilization}}
  };
}

test('observatory aggregates resource budget posture',()=>{
  const o=buildAgentTrafficObservatory([
    p('AW-A','within_budget',20),
    p('AW-B','approaching',85),
    p('AW-C','exceeded',130),
    p('AW-D','disabled',0)
  ]);
  assert.deepEqual(o.resourceBudgets,{
    enforcement:'shadow_only',
    enabledProfiles:3,
    withinBudgetProfiles:1,
    approachingProfiles:1,
    exceededProfiles:1
  });
});

test('top resource-pressure projection includes bounded budget posture',()=>{
  const o=buildAgentTrafficObservatory([p('AW-X','exceeded',175,90)]);
  assert.equal(o.topResourcePressure[0].budgetStatus,'exceeded');
  assert.equal(o.topResourcePressure[0].maxBudgetUtilization,175);
});

test('unknown budget status is treated as disabled',()=>{
  const o=buildAgentTrafficObservatory([p('AW-X','mystery',999)]);
  assert.equal(o.resourceBudgets.enabledProfiles,0);
  assert.equal(o.topResourcePressure[0].budgetStatus,'disabled');
});
