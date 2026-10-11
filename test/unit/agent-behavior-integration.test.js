import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorEngine, newProfile, publicProfile } from '../../src/behavior.js';

function makeStore() {
  const p=newProfile();
  return { p, stats:{behaviorSignals:0,agentBehaviorObservations:0}, getProfile(){return p;}, touchProfile(){} };
}
const config={secret:'integration-secret',scoreUaChange:5,scoreMissingUa:5,scoreAutomationUa:5,rapidRequestMs:250,rapidRequestBurst:3,scoreRapidBurst:5,scoreEnforcementEnabled:true,quarantineScore:1,trustProxy:false,trustedJa4Enabled:false};

test('agent behavior observation does not change score or quarantine decision',()=>{
  const store=makeStore(); const engine=new BehaviorEngine(config,store,()=>{},()=>1000);
  const before=store.p.score;
  engine.observeRequest('abcdef123456',{method:'GET',headers:{'user-agent':'Mozilla/5.0',cookie:'session=safe'}},new URL('https://example.test/api/items'));
  assert.equal(store.p.score,before);
  assert.equal(engine.shouldQuarantine('abcdef123456'),false);
  assert.equal(store.stats.agentBehaviorObservations,1);
});

test('response metrics are projected without changing score',()=>{
  const store=makeStore(); const engine=new BehaviorEngine(config,store,()=>{},()=>2000);
  engine.observeRequest('abcdef123456',{method:'GET',headers:{'user-agent':'Mozilla/5.0'}},new URL('https://example.test/missing'));
  const response={statusCode:404,getHeader(){return undefined;}};
  engine.noteResponse('abcdef123456',{method:'GET',headers:{}},response,new URL('https://example.test/missing'));
  const out=publicProfile('abcdef123456',store.p);
  assert.equal(out.agentBehavior.responses.notFound,1);
  assert.equal(out.score,0);
});

test('public projection exposes aggregate behavior but no route or cookie hashes',()=>{
  let now=0; const store=makeStore(); const engine=new BehaviorEngine(config,store,()=>{},()=>{now+=1000;return now;});
  engine.observeRequest('abcdef123456',{method:'GET',headers:{'user-agent':'Mozilla/5.0',cookie:'secret-cookie=value'}},new URL('https://example.test/private/customer/123?token=hidden'));
  const out=publicProfile('abcdef123456',store.p);
  const text=JSON.stringify(out.agentBehavior);
  assert.equal(out.agentBehavior.routeBreadth,1);
  assert.doesNotMatch(text,/customer|123|hidden|secret-cookie|value/);
});
