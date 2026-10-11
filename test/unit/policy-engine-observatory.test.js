import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTrafficObservatory } from '../../src/agent-observatory.js';

function p(id, action, eligible=false) {
  return {id,requestCount:1,score:0,agentIdentity:{trafficClass:'unknown_automation',purpose:'general_automation'},trafficScores:{automationConfidence:{score:70},policyRisk:{score:10},resourcePressure:{score:50}},resourceBudget:{status:'within_budget',utilization:{}},policyDecision:{enabled:true,action,enforcement:eligible?'eligible':'shadow_only',enforcementEligible:eligible,wouldEnforce:['throttle','decoy','quarantine'].includes(action)}};
}

test('observatory aggregates policy action counts',()=>{
  const o=buildAgentTrafficObservatory([p('A','allow'),p('B','observe'),p('C','throttle'),p('D','throttle')]);
  assert.equal(o.policyEngine.actions.allow,1);
  assert.equal(o.policyEngine.actions.observe,1);
  assert.equal(o.policyEngine.actions.throttle,2);
});

test('observatory counts enforcement-eligible profiles separately from recommendations',()=>{
  const o=buildAgentTrafficObservatory([p('A','decoy',false),p('B','quarantine',true)]);
  assert.equal(o.policyEngine.wouldEnforceProfiles,2);
  assert.equal(o.policyEngine.enforcementEligibleProfiles,1);
});
