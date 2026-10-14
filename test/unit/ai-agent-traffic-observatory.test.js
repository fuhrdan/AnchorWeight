import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiAgentTrafficObservatory, describeAiAgentTrafficObservatory } from '../../src/ai-agent-traffic-observatory.js';

function decision(overrides={}) {
  return {
    provider:'openai',family:'oai-searchbot',purpose:'search_indexing',
    action:'observe',enforcement:'observe',enforcementEligible:false,
    policySource:'declaration_policy',verificationPolicyMatched:false,
    ...overrides
  };
}
function verification(status='verified',overrides={}) {
  return {status,provider:'openai',family:'oai-searchbot',...overrides};
}

test('AI-agent traffic observatory starts empty and privacy-safe',()=>{
  const o=createAiAgentTrafficObservatory({now:()=>1});
  const s=o.snapshot();
  assert.equal(s.requests,0);
  assert.equal(s.privacy.rawIpRetained,false);
  assert.equal(s.privacy.rawUserAgentRetained,false);
  assert.equal(s.enforcement,false);
});

test('verified allow is counted without creating trust state',()=>{
  const o=createAiAgentTrafficObservatory({now:()=>1});
  o.record(decision({action:'allow',enforcement:'allow_without_trust',policySource:'verification_rule',verificationPolicyMatched:true}),verification('verified'));
  const s=o.snapshot();
  assert.equal(s.requests,1);
  assert.equal(s.verification.verified,1);
  assert.equal(s.actions.allow,1);
  assert.equal(s.outcomes.allowed,1);
  assert.equal(s.verificationPolicyMatches,1);
});

test('unverified deny in shadow mode is counted as would-deny',()=>{
  const o=createAiAgentTrafficObservatory({now:()=>1});
  o.record(decision({action:'deny',enforcement:'shadow_only'}),verification('unverified'));
  const s=o.snapshot();
  assert.equal(s.verification.unverified,1);
  assert.equal(s.outcomes.would_deny,1);
  assert.equal(s.outcomes.denied,0);
});

test('enforced deny is counted separately from would-deny',()=>{
  const o=createAiAgentTrafficObservatory({now:()=>1});
  o.record(decision({action:'deny',enforcement:'deny',enforcementEligible:true}),verification('verified'));
  const s=o.snapshot();
  assert.equal(s.outcomes.denied,1);
  assert.equal(s.outcomes.would_deny,0);
});

test('unavailable verification remains visible by provider and family',()=>{
  const o=createAiAgentTrafficObservatory({now:()=>1});
  o.record(decision({provider:'anthropic',family:'claudebot',purpose:'model_training'}),
    verification('unavailable',{provider:'anthropic',family:'claudebot'}));
  const s=o.snapshot();
  assert.equal(s.verification.unavailable,1);
  assert.equal(s.providers[0].provider,'anthropic');
  assert.equal(s.providers[0].families[0].family,'claudebot');
  assert.equal(s.providers[0].families[0].verification.unavailable,1);
});

test('provider and family counters remain separate',()=>{
  const o=createAiAgentTrafficObservatory({now:()=>1});
  o.record(decision(),verification('verified'));
  o.record(decision({provider:'perplexity',family:'perplexitybot'}),
    verification('unverified',{provider:'perplexity',family:'perplexitybot'}));
  const s=o.snapshot();
  assert.equal(s.providers.length,2);
  assert.equal(s.providers.reduce((n,p)=>n+p.requests,0),2);
});

test('recent decisions are bounded to 24 and contain no request identifiers',()=>{
  let now=1;
  const o=createAiAgentTrafficObservatory({now:()=>now++});
  for(let i=0;i<40;i++) o.record(decision({rawIp:'203.0.113.1',rawUserAgent:'secret',path:'/private'}),verification('verified'));
  const s=o.snapshot();
  assert.equal(s.recent.length,24);
  const text=JSON.stringify(s);
  assert.equal(text.includes('203.0.113.1'),false);
  assert.equal(text.includes('secret'),false);
  assert.equal(text.includes('/private'),false);
});

test('unsupported providers and malformed families are ignored',()=>{
  const o=createAiAgentTrafficObservatory();
  assert.equal(o.record(decision({provider:'other'}),verification('verified')).recorded,false);
  assert.equal(o.record(decision({family:'bad family'}),verification('verified')).recorded,false);
  assert.equal(o.snapshot().requests,0);
});

test('descriptor documents process-local bounded non-enforcing posture',()=>{
  const d=describeAiAgentTrafficObservatory();
  assert.equal(d.processLocal,true);
  assert.equal(d.resetOnRestart,true);
  assert.equal(d.maxRecentDecisions,24);
  assert.equal(d.enforcement,false);
  assert.equal(d.rawIpRetained,false);
});
