import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBurnInStaticCheck, evaluateBurnInSnapshot } from '../../scripts/burn-in-check.js';
import { createAgentPassport } from '../../src/agent-passport.js';
import { ANCHORWEIGHT_VERSION } from '../../src/version.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const contract=JSON.parse(fs.readFileSync(path.join(root,'RC1-FROZEN-CONTRACT.json'),'utf8'));
function good(){return {live:{ok:true,version:ANCHORWEIGHT_VERSION,shadowMode:true,proxyEnabled:true,basePath:'/anchor',clientIdentity:{status:'degraded',reason:'trusted_proxy_client_ip_unavailable',enforcementSafe:false}},passport:createAgentPassport({basePath:'/anchor',shadowMode:true,policyEngineEnabled:true,policyEngineShadowMode:true,policyEngineEnforcementEnabled:false,aiAgentPolicyEnabled:true,aiAgentPolicyShadowMode:true,aiAgentPolicyEnforcementEnabled:false}),contract};}

test('v3.1 alpha static burn-in compatibility gate preserves the v3.0 baseline',()=>{const result=runBurnInStaticCheck({root});assert.equal(result.ok,true,result.failures.join('\n'));assert.ok(result.checks>=30);});
test('degraded trusted-proxy identity can remain safe while AI-agent controls are shadowed',()=>{const result=evaluateBurnInSnapshot(good());assert.equal(result.ok,true,result.failures.join('\n'));assert.equal(result.enforcementGate,'blocked_by_client_identity');});
test('burn-in accepts additive Agent Passport capability growth',()=>{const input=good();assert.ok(input.passport.capabilities.aiAgentControls);assert.equal(evaluateBurnInSnapshot(input).ok,true);});
test('burn-in rejects version drift',()=>{const input=good();input.live.version='3.1.0-alpha.9';assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects leaving global shadow mode',()=>{const input=good();input.live.shadowMode=false;assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects active client-scoped Policy Engine enforcement',()=>{const input=good();input.passport.enforcement.policyEngineEnforced=true;assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects removal of a frozen v3.0 capability',()=>{const input=good();delete input.passport.capabilities.proofOfCrawl;assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects public privacy regression',()=>{const input=good();input.passport.privacy.rawIpExposed=true;assert.equal(evaluateBurnInSnapshot(input).ok,false);});
