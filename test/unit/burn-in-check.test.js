import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBurnInStaticCheck, evaluateBurnInSnapshot } from '../../scripts/burn-in-check.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const contract=JSON.parse(fs.readFileSync(path.join(root,'RC1-FROZEN-CONTRACT.json'),'utf8'));
function good(){
 return {
  live:{ok:true,version:'3.0.0',shadowMode:true,proxyEnabled:true,basePath:'/anchor',clientIdentity:{status:'degraded',reason:'trusted_proxy_client_ip_unavailable',enforcementSafe:false}},
  passport:{schema:contract.agentPassportSchema,version:'3.0.0',capabilities:{
   agentIdentity:{},agentBehavior:{},clientEnvironment:{},proxyIdentityDiagnostics:{},resourceBudgets:{},
   policyEngine:{actions:[...contract.policyActions]},policyForensics:{},policySimulation:{mutatesState:false,enforcement:false},
   enforcementRehearsal:{mutatesState:false,enforcement:false},releaseReadiness:{mutatesState:false,enforcement:false},
   trafficScoring:{},agentTrafficObservatory:{},proofOfCrawl:{}
  },enforcement:{policyEngineEnforced:false,trafficDimensionsEnforced:false,resourceBudgetsEnforced:false},
  privacy:Object.fromEntries(contract.privacyFalseFlags.map(key=>[key,false]))},
  contract
 };
}

test('v3.0.0 final static burn-in gate preserves the RC.1 frozen contract',()=>{const result=runBurnInStaticCheck({root});assert.equal(result.ok,true,result.failures.join('\n'));assert.ok(result.checks>=30);});
test('degraded trusted-proxy identity can burn in safely while enforcement stays blocked',()=>{const result=evaluateBurnInSnapshot(good());assert.equal(result.ok,true,result.failures.join('\n'));assert.equal(result.enforcementGate,'blocked_by_client_identity');assert.ok(result.warnings.some(x=>x.includes('client identity')));});
test('a future trusted identity is accepted but still requires the external release gate',()=>{const input=good();input.live.clientIdentity={status:'trusted',reason:null,enforcementSafe:true};const result=evaluateBurnInSnapshot(input);assert.equal(result.ok,true,result.failures.join('\n'));assert.equal(result.enforcementGate,'client_identity_safe_external_gate_still_required');});
test('burn-in rejects version drift',()=>{const input=good();input.live.version='3.0.0-rc.9';assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects leaving shadow mode',()=>{const input=good();input.live.shadowMode=false;assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects active Policy Engine enforcement',()=>{const input=good();input.passport.enforcement.policyEngineEnforced=true;assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects Agent Passport capability drift',()=>{const input=good();delete input.passport.capabilities.proofOfCrawl;assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects public privacy regression',()=>{const input=good();input.passport.privacy.rawIpExposed=true;assert.equal(evaluateBurnInSnapshot(input).ok,false);});
test('burn-in rejects duplicate standalone AnchorWeight app workers',()=>{const input=good();input.processes={standaloneAppProcesses:2,lsnodeProcesses:3,totalAnchorWeightThreads:50};const result=evaluateBurnInSnapshot(input);assert.equal(result.ok,false);assert.ok(result.failures.some(x=>x.includes('multiple standalone')));});
