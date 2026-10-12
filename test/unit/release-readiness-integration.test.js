import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORWEIGHT_VERSION } from '../../src/version.js';
import { AGENT_PASSPORT_VERSION, createAgentPassport } from '../../src/agent-passport.js';
import { buildReleaseReadiness } from '../../src/release-readiness.js';

test('Agent Passport uses the central version and advertises advisory release readiness',()=>{
  const passport=createAgentPassport({shadowMode:true});
  assert.equal(AGENT_PASSPORT_VERSION,ANCHORWEIGHT_VERSION);
  assert.equal(passport.version,ANCHORWEIGHT_VERSION);
  assert.equal(passport.capabilities.releaseReadiness.advisoryOnly,true);
  assert.equal(passport.capabilities.releaseReadiness.enforcement,false);
});

test('release readiness output contains no raw request identity fields',()=>{
  const result=buildReleaseReadiness({
    config:{proxyEnabled:true,policyEngineEnabled:true,shadowMode:true,policyEngineShadowMode:true},
    clientIdentity:{status:'degraded',reason:'proxy_client_ip_unavailable',enforcementSafe:false,ip:'203.0.113.10'},
    publicProfiles:[{id:'AW-12345678',review:{status:'needs_review'},trafficScores:{automationConfidence:{score:1},policyRisk:{score:2},resourcePressure:{score:3}},rawIp:'203.0.113.10',rawPath:'/private'}],
    agentObservatory:{policyCalibration:{evaluations:1,highImpactRecommendations:0}}
  });
  const text=JSON.stringify(result);
  assert.doesNotMatch(text,/203\.0\.113\.10|\/private/);
});
