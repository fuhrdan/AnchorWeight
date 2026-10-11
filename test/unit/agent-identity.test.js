import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAFFIC_CLASSES,
  AGENT_PURPOSES,
  observeTrafficIdentity,
  recordTrafficIdentity,
  publicTrafficIdentity
} from '../../src/agent-identity.js';

function req(userAgent) {
  return { headers: userAgent === undefined ? {} : { 'user-agent':userAgent } };
}

test('ordinary browser remains browser_or_unknown',()=>{
  const result=observeTrafficIdentity(req('Mozilla/5.0 AppleWebKit/537.36 Chrome/154 Safari/537.36'));
  assert.equal(result.trafficClass,TRAFFIC_CLASSES.BROWSER_OR_UNKNOWN);
  assert.equal(result.declared,false);
  assert.equal(result.confidence,'none');
});

test('OpenAI crawler purposes remain distinct and declarative only',()=>{
  const training=observeTrafficIdentity(req('Mozilla/5.0; compatible; GPTBot/1.4; +https://openai.com/gptbot'));
  assert.equal(training.trafficClass,TRAFFIC_CLASSES.DECLARED_AI_CRAWLER);
  assert.equal(training.provider,'openai');
  assert.equal(training.purpose,AGENT_PURPOSES.MODEL_TRAINING);
  assert.equal(training.confidence,'declared');

  const search=observeTrafficIdentity(req('Mozilla/5.0; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot'));
  assert.equal(search.trafficClass,TRAFFIC_CLASSES.DECLARED_AI_CRAWLER);
  assert.equal(search.purpose,AGENT_PURPOSES.SEARCH_INDEXING);

  const user=observeTrafficIdentity(req('Mozilla/5.0; compatible; ChatGPT-User/1.0; +https://openai.com/bot'));
  assert.equal(user.trafficClass,TRAFFIC_CLASSES.USER_DIRECTED_AGENT);
  assert.equal(user.purpose,AGENT_PURPOSES.USER_RETRIEVAL);
});

test('Anthropic crawler purposes remain distinct and declarative only',()=>{
  const training=observeTrafficIdentity(req('ClaudeBot/1.0'));
  assert.equal(training.provider,'anthropic');
  assert.equal(training.trafficClass,TRAFFIC_CLASSES.DECLARED_AI_CRAWLER);
  assert.equal(training.purpose,AGENT_PURPOSES.MODEL_TRAINING);

  const search=observeTrafficIdentity(req('Claude-SearchBot/1.0'));
  assert.equal(search.trafficClass,TRAFFIC_CLASSES.DECLARED_AI_CRAWLER);
  assert.equal(search.purpose,AGENT_PURPOSES.SEARCH_INDEXING);

  const user=observeTrafficIdentity(req('Claude-User/1.0'));
  assert.equal(user.trafficClass,TRAFFIC_CLASSES.USER_DIRECTED_AGENT);
  assert.equal(user.purpose,AGENT_PURPOSES.USER_RETRIEVAL);
});

test('generic automation is observed without pretending to know provider',()=>{
  const result=observeTrafficIdentity(req('curl/8.10.1'));
  assert.equal(result.trafficClass,TRAFFIC_CLASSES.UNKNOWN_AUTOMATION);
  assert.equal(result.provider,null);
  assert.equal(result.confidence,'heuristic');
  assert.equal(result.declared,false);
});

test('recorded identity is privacy-minimized, bounded and never stores raw user-agent',()=>{
  const profile={};
  const ua='Mozilla/5.0 secret-marker-should-never-persist; compatible; GPTBot/1.4';
  for(let i=0;i<20;i++) {
    const observation=observeTrafficIdentity(req(i%2 ? ua : 'curl/8.0'));
    recordTrafficIdentity(profile,observation,1000+i);
  }
  assert.equal(profile.agentIdentity.observations,20);
  assert.ok(profile.agentIdentity.history.length<=8);
  assert.equal(JSON.stringify(profile).includes('secret-marker-should-never-persist'),false);
});

test('verified good-bot evidence outranks a user-agent claim in public identity',()=>{
  const profile={ goodBotClaimed:true, goodBotVerified:true, goodBotProvider:'google' };
  recordTrafficIdentity(profile,observeTrafficIdentity(req('curl/8.0')),1234);
  const result=publicTrafficIdentity(profile);
  assert.equal(result.trafficClass,TRAFFIC_CLASSES.VERIFIED_SEARCH_CRAWLER);
  assert.equal(result.confidence,'verified');
  assert.equal(result.provider,'google');
});

test('missing, malformed and multi-valued user-agent inputs fail safely',()=>{
  assert.equal(observeTrafficIdentity(req()).trafficClass,TRAFFIC_CLASSES.BROWSER_OR_UNKNOWN);
  assert.equal(observeTrafficIdentity({headers:{'user-agent':42}}).trafficClass,TRAFFIC_CLASSES.BROWSER_OR_UNKNOWN);
  const multi=observeTrafficIdentity({headers:{'user-agent':['Mozilla/5.0','Claude-User/1.0']}});
  assert.equal(multi.trafficClass,TRAFFIC_CLASSES.USER_DIRECTED_AGENT);
});
