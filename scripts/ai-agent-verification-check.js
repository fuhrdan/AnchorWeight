#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAiAgentVerifier, describeAiAgentVerification, ipInCidr } from '../src/ai-agent-verification.js';
import { createAgentPassport } from '../src/agent-passport.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');
function response(prefix){const body=JSON.stringify({prefixes:[{ipv4Prefix:prefix}]});return {ok:true,status:200,headers:{get(){return String(Buffer.byteLength(body));}},async text(){return body;}};}
function id(provider,family,purpose='search_indexing'){return {declared:true,provider,family,purpose};}
function safe(ip){return {enforcementSafe:true,ip,status:'trusted'};}

export async function runAiAgentVerificationCheck({root=ROOT}={}) {
  const failures=[];let checks=0;const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};
  check(ANCHORWEIGHT_VERSION==='3.1.0-alpha.2','runtime version must be 3.1.0-alpha.2');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='alpha','release channel must be alpha');
  check(ipInCidr('203.0.113.7','203.0.113.0/24'),'IPv4 CIDR matcher failed');
  check(!ipInCidr('203.0.114.7','203.0.113.0/24'),'IPv4 CIDR matcher overmatched');
  check(ipInCidr('2001:db8::7','2001:db8::/32'),'IPv6 CIDR matcher failed');

  for(const [provider,family,purpose,needle] of [
    ['openai','gptbot','model_training','gptbot.json'],
    ['openai','oai-searchbot','search_indexing','searchbot.json'],
    ['openai','chatgpt-user','user_retrieval','chatgpt-user.json'],
    ['perplexity','perplexitybot','search_indexing','perplexitybot.json'],
    ['perplexity','perplexity-user','user_retrieval','perplexity-user.json'],
    ['google','google-agent','user_retrieval','user-triggered-agents.json'],
    ['google','google-gemininotebook','user_retrieval','user-triggered-fetchers-google.json'],
    ['google','google-cloudvertexbot','general_automation','common-crawlers.json']
  ]){
    let seen='';
    const verifier=createAiAgentVerifier({}, {fetchImpl:async url=>{seen=url;return response('203.0.113.0/24');}});
    const r=await verifier.verify(id(provider,family,purpose),safe('203.0.113.8'));
    check(r.verified===true && seen.endsWith(needle),`${provider}:${family} published-range verification mapping failed`);
    check(r.trustGranted===false,`${provider}:${family} verification must not grant trust`);
  }

  let calls=0;
  const anth=createAiAgentVerifier({}, {fetchImpl:async()=>{calls++;return response('203.0.113.0/24');}});
  const ar=await anth.verify(id('anthropic','claudebot','model_training'),safe('203.0.113.8'));
  check(ar.status==='unavailable' && ar.reason==='provider_ranges_unpublished' && calls===0,'Anthropic must remain explicitly unverifiable by published ranges');

  const degraded=createAiAgentVerifier({}, {fetchImpl:async()=>{calls++;return response('203.0.113.0/24');}});
  const dr=await degraded.verify(id('openai','gptbot','model_training'),{enforcementSafe:false,status:'degraded'});
  check(dr.status==='unavailable' && dr.reason==='trusted_client_identity_required','degraded client identity must block network verification');

  const descriptor=describeAiAgentVerification({});
  check(descriptor.allowGrantsTrust===false,'verification descriptor must not grant trust');
  check(descriptor.requestDenyDependsOnVerification===false,'alpha.1 request deny must remain independent from alpha.2 verification');
  check(descriptor.googleWebBotAuth?.status==='experimental_not_implemented','Google Web Bot Auth must not be overstated as implemented');

  const passport=createAgentPassport({});
  check(passport.capabilities?.aiAgentControls?.version===2,'Agent Passport must publish AI Agent Controls v2');
  check(passport.capabilities?.aiAgentControls?.verification?.available===true,'Agent Passport must publish verification availability');
  check(passport.capabilities?.aiAgentControls?.verification?.allowGrantsTrust===false,'Agent Passport verification must not grant trust');

  for(const file of ['src/ai-agent-verification.js','test/unit/ai-agent-verification.test.js','VERIFIED-AI-AGENTS.md','V3.1.0-ALPHA2-RELEASE-NOTES.md'])
    check(fs.existsSync(path.join(root,file)),`missing alpha.2 artifact ${file}`);

  const anchor=fs.readFileSync(path.join(root,'src/anchorweight.js'),'utf8');
  check(anchor.includes('createAiAgentVerifier') && anchor.includes('verificationStatus'),'runtime verification wiring is missing');
  const config=fs.readFileSync(path.join(root,'src/config.js'),'utf8');
  check(config.includes('AW_AI_AGENT_VERIFICATION_ENABLED') && config.includes('AW_AI_AGENT_VERIFICATION_CACHE_MINUTES'),'verification configuration wiring is missing');

  return {ok:failures.length===0,checks,failures};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const r=await runAiAgentVerificationCheck();
  if(!r.ok){for(const f of r.failures)console.error('FAIL:',f);process.exit(1);}
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} AI Agent Verification PASS (${r.checks} invariants checked)`);
}
