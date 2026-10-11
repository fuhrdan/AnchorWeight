import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PASSPORT_PATH,
  AGENT_PASSPORT_SCHEMA,
  AGENT_PASSPORT_VERSION,
  createAgentPassport,
  handleAgentPassport
} from '../../src/agent-passport.js';

function responseMock() {
  const headers = new Map();
  return {
    statusCode:0,
    body:null,
    setHeader(name,value){ headers.set(String(name).toLowerCase(), String(value)); },
    getHeader(name){ return headers.get(String(name).toLowerCase()); },
    end(body=''){ this.body=String(body); }
  };
}

test('agent passport publishes stable schema and version',()=>{
  const p=createAgentPassport({});
  assert.equal(p.schema,AGENT_PASSPORT_SCHEMA);
  assert.equal(p.version,AGENT_PASSPORT_VERSION);
  assert.equal(p.endpoint,AGENT_PASSPORT_PATH);
  assert.deepEqual(p.discovery.methods,['GET','HEAD']);
});

test('agent passport advertises v3 identity behavior scoring and observatory capabilities',()=>{
  const p=createAgentPassport({});
  assert.ok(p.capabilities.agentIdentity.trafficClasses.includes('user_directed_agent'));
  assert.ok(p.capabilities.agentIdentity.declaredPurposes.includes('model_training'));
  assert.equal(p.capabilities.agentBehavior.observationOnly,true);
  assert.deepEqual(p.capabilities.trafficScoring.dimensions,['automationConfidence','policyRisk','resourcePressure']);
  assert.equal(p.capabilities.agentTrafficObservatory.authenticated,true);
});

test('agent passport keeps v3 dimensions and beta.1 budgets outside enforcement',()=>{
  const p=createAgentPassport({shadowMode:false,scoreEnforcementEnabled:true});
  assert.equal(p.enforcement.shadowMode,false);
  assert.equal(p.enforcement.legacyScoreEnforcementEnabled,true);
  assert.equal(p.enforcement.trafficDimensionsEnforced,false);
  assert.equal(p.enforcement.resourceBudgetsAvailable,true);
  assert.equal(p.enforcement.resourceBudgetsEnforced,false);
  assert.equal(p.enforcement.policyEngineAvailable,false);
  assert.equal(p.capabilities.trafficScoring.enforcement,'legacy_score_only');
  assert.equal(p.capabilities.resourceBudgets.shadowOnly,true);
});

test('agent passport never serializes private config values',()=>{
  const config={
    secret:'top-secret',dashboardToken:'dashboard-secret',originUrl:'https://private.example',
    alertSigningKey:'signing-secret',shadowMode:true,scoreEnforcementEnabled:false
  };
  const text=JSON.stringify(createAgentPassport(config));
  for(const value of ['top-secret','dashboard-secret','private.example','signing-secret']) assert.equal(text.includes(value),false);
  assert.equal(createAgentPassport(config).privacy.originExposed,false);
});

test('agent passport is deterministic and does not mutate config',()=>{
  const config={shadowMode:true,scoreEnforcementEnabled:false,secret:'x'};
  const before=JSON.stringify(config);
  assert.equal(JSON.stringify(createAgentPassport(config)),JSON.stringify(createAgentPassport(config)));
  assert.equal(JSON.stringify(config),before);
});

test('passport handler ignores unrelated paths',()=>{
  const res=responseMock();
  assert.equal(handleAgentPassport({method:'GET'},res,new URL('https://example.test/elsewhere'),{}),false);
  assert.equal(res.statusCode,0);
});

test('passport handler serves GET as public cacheable JSON',()=>{
  const res=responseMock();
  assert.equal(handleAgentPassport({method:'GET'},res,new URL(`https://example.test${AGENT_PASSPORT_PATH}`),{shadowMode:true}),true);
  assert.equal(res.statusCode,200);
  assert.equal(res.getHeader('access-control-allow-origin'),'*');
  assert.equal(res.getHeader('cache-control'),'public, max-age=300');
  assert.equal(JSON.parse(res.body).enforcement.shadowMode,true);
});

test('passport handler serves HEAD without a response body',()=>{
  const res=responseMock();
  handleAgentPassport({method:'HEAD'},res,new URL(`https://example.test${AGENT_PASSPORT_PATH}`),{});
  assert.equal(res.statusCode,200);
  assert.equal(res.body,'');
  assert.ok(Number(res.getHeader('content-length'))>0);
});

test('passport handler rejects unsupported methods',()=>{
  const res=responseMock();
  handleAgentPassport({method:'POST'},res,new URL(`https://example.test${AGENT_PASSPORT_PATH}`),{});
  assert.equal(res.statusCode,405);
  assert.equal(res.getHeader('allow'),'GET, HEAD');
  assert.equal(JSON.parse(res.body).error,'method_not_allowed');
});
