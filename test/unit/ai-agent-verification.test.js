import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiAgentVerifier,
  AI_AGENT_VERIFICATION_STATUS,
  ipInCidr,
  normalizeCidr,
  parsePublishedPrefixes,
  describeAiAgentVerification
} from '../../src/ai-agent-verification.js';

function jsonResponse(body,{status=200}={}) {
  const text=JSON.stringify(body);
  return {ok:status>=200&&status<300,status,headers:{get(){return String(Buffer.byteLength(text));}},async text(){return text;}};
}
function identity(provider,family,purpose='search_indexing'){return {declared:true,provider,family,purpose};}
function safe(ip){return {status:'trusted',enforcementSafe:true,ip};}
function degraded(){return {status:'degraded',enforcementSafe:false,ip:null};}

test('IPv4 CIDR matching is exact and bounded',()=>{
  assert.equal(ipInCidr('203.0.113.9','203.0.113.0/24'),true);
  assert.equal(ipInCidr('203.0.114.9','203.0.113.0/24'),false);
  assert.equal(normalizeCidr('203.0.113.0/33'),null);
});
test('IPv6 CIDR matching is supported',()=>{
  assert.equal(ipInCidr('2001:db8::42','2001:db8::/32'),true);
  assert.equal(ipInCidr('2001:db9::42','2001:db8::/32'),false);
});
test('published prefix parser accepts IPv4 and IPv6 without exposing raw callers',()=>{
  const p=parsePublishedPrefixes({prefixes:[{ipv4Prefix:'203.0.113.0/24'},{ipv6Prefix:'2001:db8::/32'}]});
  assert.equal(p.length,2);
});
test('OpenAI family verification uses the family-specific published feed',async()=>{
  let seen='';
  const v=new AiAgentVerifier({}, {fetchImpl:async url=>{seen=url;return jsonResponse({prefixes:[{ipv4Prefix:'203.0.113.0/24'}]});}});
  const r=await v.verify(identity('openai','gptbot','model_training'),safe('203.0.113.9'));
  assert.equal(r.status,'verified');assert.equal(r.scope,'family_network');assert.match(seen,/gptbot\.json$/);assert.equal(r.trustGranted,false);
});
test('OpenAI family mismatch is explicitly unverified',async()=>{
  const v=new AiAgentVerifier({}, {fetchImpl:async()=>jsonResponse({prefixes:[{ipv4Prefix:'203.0.113.0/24'}]})});
  const r=await v.verify(identity('openai','oai-searchbot'),safe('198.51.100.9'));
  assert.equal(r.status,'unverified');assert.equal(r.reason,'published_range_mismatch');
});
test('Perplexity uses family-specific published ranges',async()=>{
  let seen='';
  const v=new AiAgentVerifier({}, {fetchImpl:async url=>{seen=url;return jsonResponse({prefixes:[{ipv4Prefix:'198.51.100.0/24'}]});}});
  const r=await v.verify(identity('perplexity','perplexity-user','user_retrieval'),safe('198.51.100.7'));
  assert.equal(r.status,'verified');assert.match(seen,/perplexity-user\.json$/);
});
test('Google-Agent uses Google user-triggered agent ranges',async()=>{
  let seen='';
  const v=new AiAgentVerifier({}, {fetchImpl:async url=>{seen=url;return jsonResponse({prefixes:[{ipv4Prefix:'192.0.2.0/24'}]});}});
  const r=await v.verify(identity('google','google-agent','user_retrieval'),safe('192.0.2.3'));
  assert.equal(r.status,'verified');assert.equal(r.scope,'provider_category_network');assert.match(seen,/user-triggered-agents\.json$/);
});
test('Gemini Notebook uses Google-controlled user-triggered fetcher ranges',async()=>{
  let seen='';
  const v=new AiAgentVerifier({}, {fetchImpl:async url=>{seen=url;return jsonResponse({prefixes:[{ipv4Prefix:'192.0.2.0/24'}]});}});
  const r=await v.verify(identity('google','google-gemininotebook','user_retrieval'),safe('192.0.2.4'));
  assert.equal(r.status,'verified');assert.match(seen,/user-triggered-fetchers-google\.json$/);
});
test('Google Cloud Vertex bot uses common crawler ranges',async()=>{
  let seen='';
  const v=new AiAgentVerifier({}, {fetchImpl:async url=>{seen=url;return jsonResponse({prefixes:[{ipv4Prefix:'192.0.2.0/24'}]});}});
  const r=await v.verify(identity('google','google-cloudvertexbot','general_automation'),safe('192.0.2.5'));
  assert.equal(r.status,'verified');assert.match(seen,/common-crawlers\.json$/);
});
test('Anthropic is explicitly unverifiable because it publishes no ranges',async()=>{
  let calls=0;
  const v=new AiAgentVerifier({}, {fetchImpl:async()=>{calls++;throw Error('should_not_fetch');}});
  const r=await v.verify(identity('anthropic','claudebot','model_training'),safe('203.0.113.1'));
  assert.equal(r.status,'unavailable');assert.equal(r.reason,'provider_ranges_unpublished');assert.equal(calls,0);
});
test('degraded client identity blocks network verification without making a network request',async()=>{
  let calls=0;
  const v=new AiAgentVerifier({}, {fetchImpl:async()=>{calls++;return jsonResponse({prefixes:[{ipv4Prefix:'203.0.113.0/24'}]});}});
  const r=await v.verify(identity('openai','gptbot','model_training'),degraded());
  assert.equal(r.status,'unavailable');assert.equal(r.reason,'trusted_client_identity_required');assert.equal(calls,0);
});
test('verification feed cache prevents repeated network fetches',async()=>{
  let calls=0;
  const v=new AiAgentVerifier({aiAgentVerificationCacheMinutes:60},{now:()=>1000,fetchImpl:async()=>{calls++;return jsonResponse({prefixes:[{ipv4Prefix:'203.0.113.0/24'}]});}});
  await v.verify(identity('openai','gptbot'),safe('203.0.113.1'));
  const r=await v.verify(identity('openai','gptbot'),safe('203.0.113.2'));
  assert.equal(calls,1);assert.equal(r.cache,'hit');
});
test('feed failures fail closed to unavailable rather than verified',async()=>{
  const v=new AiAgentVerifier({}, {fetchImpl:async()=>{throw Error('network_down');}});
  const r=await v.verify(identity('openai','gptbot'),safe('203.0.113.1'));
  assert.equal(r.status,AI_AGENT_VERIFICATION_STATUS.UNAVAILABLE);assert.equal(r.verified,false);assert.equal(r.reason,'network_down');
});
test('verification can be disabled without changing declared policy behavior',async()=>{
  const v=new AiAgentVerifier({aiAgentVerificationEnabled:false});
  const r=await v.verify(identity('openai','gptbot'),safe('203.0.113.1'));
  assert.equal(r.status,'disabled');assert.equal(r.trustGranted,false);
});
test('verification descriptor promises no allow trust and documents Google Web Bot Auth as experimental',()=>{
  const d=describeAiAgentVerification({});
  assert.equal(d.allowGrantsTrust,false);assert.equal(d.requiresTrustedClientIdentity,true);
  assert.equal(d.googleWebBotAuth.status,'experimental_not_implemented');
});
