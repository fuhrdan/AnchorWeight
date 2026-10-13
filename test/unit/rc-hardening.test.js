import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';
import { createAgentPassport } from '../../src/agent-passport.js';
import { evaluatePolicyDecision } from '../../src/policy-engine.js';
import { buildReleaseReadiness } from '../../src/release-readiness.js';
import { enforcementRehearsalDescriptor } from '../../src/enforcement-rehearsal.js';
import { runRcHardeningCheck } from '../../scripts/rc-hardening-check.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const contract=JSON.parse(fs.readFileSync(path.join(root,'RC1-FROZEN-CONTRACT.json'),'utf8'));
const shadowConfig={basePath:'/anchor',shadowMode:true,scoreEnforcementEnabled:false,policyEngineEnabled:true,policyEngineEnforcementEnabled:false,policyEngineShadowMode:true};

test('v3.0.0 final exposes one runtime version owner and rc channel',()=>{
  assert.equal(ANCHORWEIGHT_VERSION,'3.0.0');
  assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'stable');
});

test('v3.0.0 final frozen Agent Passport capability surface matches beta.7 production contract',()=>{
  const passport=createAgentPassport(shadowConfig);
  assert.equal(passport.schema,contract.agentPassportSchema);
  assert.deepEqual(Object.keys(passport.capabilities).sort(),[...contract.capabilities].sort());
  assert.deepEqual(passport.capabilities.policyEngine.actions,contract.policyActions);
});

test('v3.0.0 final frozen privacy contract keeps raw request identity and credentials out',()=>{
  const passport=createAgentPassport(shadowConfig);
  for(const key of contract.privacyFalseFlags) assert.equal(passport.privacy[key],false,key);
});

test('v3.0.0 final default public enforcement posture remains non-enforcing',()=>{
  const passport=createAgentPassport(shadowConfig);
  for(const [key,value] of Object.entries(contract.enforcementDefaults)) assert.equal(passport.enforcement[key],value,key);
});

test('v3.0.0 final high-risk policy recommendation remains shadow-only without explicit enforcement gates',()=>{
  const decision=evaluatePolicyDecision(
    {blackholeVisits:1,invalidTraversals:2,proofOfCrawl:1,goodBotVerified:false},
    {automationConfidence:{score:95},policyRisk:{score:95},resourcePressure:{score:90}},
    {status:'exceeded'},shadowConfig,{now:1234}
  );
  assert.equal(decision.wouldEnforce,true);
  assert.equal(decision.enforcementEligible,false);
  assert.equal(decision.enforcement,'shadow_only');
});

test('v3.0.0 final degraded client identity remains a hard readiness blocker',()=>{
  const readiness=buildReleaseReadiness({
    config:shadowConfig,
    clientIdentity:{status:'degraded',reason:'trusted_proxy_client_ip_unavailable',enforcementSafe:false},
    publicProfiles:[],agentObservatory:{policyCalibration:{evaluations:0,highImpactRecommendations:0}}
  });
  assert.equal(readiness.verdict,'blocked');
  assert.equal(readiness.enforcementReady,false);
  assert.equal(readiness.checks.find(x=>x.id==='client_identity').status,'fail');
});

test('v3.0.0 final Enforcement Rehearsal remains advisory, non-mutating, and identity-gated',()=>{
  const descriptor=enforcementRehearsalDescriptor();
  assert.equal(descriptor.advisoryOnly,true);
  assert.equal(descriptor.mutatesState,false);
  assert.equal(descriptor.enforcement,false);
  assert.equal(descriptor.requiresTrustedClientIdentityForTrial,true);
});

test('v3.0.0 final hardening gate passes the frozen contract',()=>{
  const result=runRcHardeningCheck({root});
  assert.equal(result.ok,true,result.failures.join('\n'));
  assert.ok(result.checks>=25);
});
