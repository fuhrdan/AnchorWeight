import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTrafficObservatory } from '../../src/agent-observatory.js';

function p(id, cls, purpose, automation, policy, pressure, requestCount=1) {
  return {
    id, requestCount, score:7,
    agentIdentity:{trafficClass:cls,purpose},
    trafficScores:{
      automationConfidence:{score:automation},
      policyRisk:{score:policy},
      resourcePressure:{score:pressure}
    }
  };
}

test('empty observatory is stable and observation-only',()=>{
  const o=buildAgentTrafficObservatory([]);
  assert.equal(o.trackedProfiles,0);
  assert.equal(o.enforcement,'observation_only');
  assert.deepEqual(o.topResourcePressure,[]);
});

test('traffic classes and purposes are aggregated independently',()=>{
  const o=buildAgentTrafficObservatory([
    p('AW-A','declared_ai_crawler','model_training',90,0,10),
    p('AW-B','user_directed_agent','user_retrieval',85,0,5),
    p('AW-C','declared_ai_crawler','search_indexing',90,0,15)
  ]);
  assert.equal(o.trafficClasses.declared_ai_crawler,2);
  assert.equal(o.trafficClasses.user_directed_agent,1);
  assert.equal(o.purposes.model_training,1);
  assert.equal(o.purposes.search_indexing,1);
});

test('dimension averages and concern counts remain separate',()=>{
  const o=buildAgentTrafficObservatory([
    p('AW-A','verified_search_crawler','search_indexing',95,0,10),
    p('AW-B','unknown_automation','general_automation',70,80,90)
  ]);
  assert.equal(o.averages.automationConfidence,83);
  assert.equal(o.averages.policyRisk,40);
  assert.equal(o.averages.resourcePressure,50);
  assert.equal(o.automatedProfiles,2);
  assert.equal(o.policyConcernProfiles,1);
  assert.equal(o.highPressureProfiles,1);
});

test('score bands use the same public five-level vocabulary',()=>{
  const o=buildAgentTrafficObservatory([
    p('A','browser_or_unknown','unknown',0,0,0),
    p('B','unknown_automation','unknown',20,20,20),
    p('C','unknown_automation','unknown',50,50,50),
    p('D','unknown_automation','unknown',70,70,70),
    p('E','unknown_automation','unknown',90,90,90)
  ]);
  assert.deepEqual(o.bands.resourcePressure,{minimal:1,low:1,moderate:1,high:1,very_high:1});
});

test('top lists are sorted by the selected dimension, not legacy score',()=>{
  const o=buildAgentTrafficObservatory([
    p('AW-LOW','browser_or_unknown','unknown',0,0,5,100),
    p('AW-HIGH','unknown_automation','general_automation',70,20,95,2)
  ]);
  assert.equal(o.topResourcePressure[0].id,'AW-HIGH');
  assert.equal(o.topAutomation[0].id,'AW-HIGH');
});

test('observatory output never includes raw profile internals',()=>{
  const profile=p('AW-ABCD','unknown_automation','general_automation',70,40,65);
  profile.rawIp='203.0.113.9';
  profile.agentBehavior={routeHashes:['secret-route-hash'],cookieHashes:['secret-cookie-hash']};
  const text=JSON.stringify(buildAgentTrafficObservatory([profile]));
  assert.doesNotMatch(text,/203\.0\.113\.9|secret-route-hash|secret-cookie-hash/);
});
