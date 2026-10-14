import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';
import { createAgentPassport } from '../../src/agent-passport.js';
import { evaluatePolicyDecision } from '../../src/policy-engine.js';
import { buildReleaseReadiness } from '../../src/release-readiness.js';
import { runRcHardeningCheck } from '../../scripts/rc-hardening-check.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const contract=JSON.parse(fs.readFileSync(path.join(root,'RC1-FROZEN-CONTRACT.json'),'utf8'));
const shadowConfig={basePath:'/anchor',shadowMode:true,scoreEnforcementEnabled:false,policyEngineEnabled:true,policyEngineEnforcementEnabled:false,policyEngineShadowMode:true,aiAgentPolicyEnabled:true,aiAgentPolicyShadowMode:true,aiAgentPolicyEnforcementEnabled:false};

test('v3.1 alpha exposes alpha release metadata',()=>{assert.equal(ANCHORWEIGHT_VERSION,'3.1.0-beta.2');assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'beta');});
test('v3.1 retains every frozen v3.0 capability and adds AI Agent Controls',()=>{const p=createAgentPassport(shadowConfig);for(const key of contract.capabilities)assert.ok(p.capabilities[key],key);assert.equal(p.capabilities.aiAgentControls.version,9);assert.deepEqual(p.capabilities.policyEngine.actions,contract.policyActions);});
test('v3.1 retains v3.0 privacy invariants',()=>{const p=createAgentPassport(shadowConfig);for(const key of contract.privacyFalseFlags)assert.equal(p.privacy[key],false,key);});
test('v3.1 keeps existing client-scoped enforcement defaults non-enforcing',()=>{const p=createAgentPassport(shadowConfig);for(const [key,value] of Object.entries(contract.enforcementDefaults))assert.equal(p.enforcement[key],value,key);assert.equal(p.enforcement.aiAgentPolicyEnforced,false);});
test('legacy high-risk policy remains shadow-only without explicit enforcement gates',()=>{const d=evaluatePolicyDecision({blackholeVisits:1,invalidTraversals:2,proofOfCrawl:1,goodBotVerified:false},{automationConfidence:{score:95},policyRisk:{score:95},resourcePressure:{score:90}},{status:'exceeded'},shadowConfig,{now:1234});assert.equal(d.wouldEnforce,true);assert.equal(d.enforcementEligible,false);assert.equal(d.enforcement,'shadow_only');});
test('degraded client identity remains a hard blocker for client-scoped release readiness',()=>{const r=buildReleaseReadiness({config:shadowConfig,clientIdentity:{status:'degraded',reason:'trusted_proxy_client_ip_unavailable',enforcementSafe:false},publicProfiles:[],agentObservatory:{policyCalibration:{evaluations:0,highImpactRecommendations:0}}});assert.equal(r.verdict,'blocked');assert.equal(r.enforcementReady,false);});
test('v3 compatibility hardening gate passes',()=>{const result=runRcHardeningCheck({root});assert.equal(result.ok,true,result.failures.join('\n'));assert.ok(result.checks>=25);});
