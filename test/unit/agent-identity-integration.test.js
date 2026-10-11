import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorEngine, publicProfile } from '../../src/behavior.js';
import { MemoryStore } from '../../src/store.js';
import { TRAFFIC_CLASSES } from '../../src/agent-identity.js';

const KEY='abcdef12345678';
const config={
  secret:'alpha-one-test-secret', trustProxy:false, trustedJa4Enabled:false,
  scoreUaChange:0, scoreMissingUa:0, scoreAutomationUa:0, scoreRapidBurst:0,
  scoreLure:0, scoreBlackhole:0, scoreTraversal:0, scoreInvalidTraversal:0,
  scoreProofOfCrawl:0, scoreSpoofedGoodBot:0,
  rapidRequestMs:0, rapidRequestBurst:9999,
  scoreEnforcementEnabled:false, quarantineScore:100,
  adaptiveDeceptionEnabled:false, adaptiveInterventionEnabled:false
};

test('agent identity observation does not change risk score or enforcement',()=>{
  const store=new MemoryStore(()=>1000);
  const behavior=new BehaviorEngine(config,store,()=>{},()=>1000);
  const p=behavior.observeRequest(KEY,{method:'GET',headers:{'user-agent':'GPTBot/1.4',accept:'text/html'}},{pathname:'/docs'});
  const view=publicProfile(KEY,p);
  assert.equal(p.score,0);
  assert.equal(behavior.shouldQuarantine(KEY),false);
  assert.equal(view.agentIdentity.trafficClass,TRAFFIC_CLASSES.DECLARED_AI_CRAWLER);
  assert.equal(view.agentIdentity.provider,'openai');
  assert.equal(view.agentIdentity.confidence,'declared');
});

test('user-directed agents remain distinct from autonomous crawlers',()=>{
  const store=new MemoryStore(()=>2000);
  const behavior=new BehaviorEngine(config,store,()=>{},()=>2000);
  const p=behavior.observeRequest(KEY,{method:'GET',headers:{'user-agent':'Claude-User/1.0',accept:'text/html'}},{pathname:'/article'});
  assert.equal(publicProfile(KEY,p).agentIdentity.trafficClass,TRAFFIC_CLASSES.USER_DIRECTED_AGENT);
});

test('verified search crawler identity takes precedence in public projection',()=>{
  const store=new MemoryStore(()=>3000);
  const behavior=new BehaviorEngine(config,store,()=>{},()=>3000);
  behavior.observeRequest(KEY,{method:'GET',headers:{'user-agent':'Googlebot/2.1',accept:'text/html'}},{pathname:'/'});
  behavior.noteGoodBot(KEY,{claimed:true,verified:true,provider:'google',reason:'verified'});
  const view=publicProfile(KEY,store.getProfile(KEY));
  assert.equal(view.agentIdentity.trafficClass,TRAFFIC_CLASSES.VERIFIED_SEARCH_CRAWLER);
  assert.equal(view.agentIdentity.confidence,'verified');
});
