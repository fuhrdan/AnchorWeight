#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { observeTrafficIdentity } from '../src/agent-identity.js';
import { evaluateAiAgentRequestPolicy, buildAiAgentRobots, describeAiAgentPolicy } from '../src/ai-agent-policy.js';
import { createAgentPassport } from '../src/agent-passport.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');
function req(ua){return {headers:{'user-agent':ua}};}
function base(overrides={}){return {
  basePath:'/anchor', shadowMode:true,
  aiAgentPolicyEnabled:true, aiAgentPolicyShadowMode:true, aiAgentPolicyEnforcementEnabled:false,
  aiAgentTrainingAction:'observe', aiAgentSearchAction:'observe', aiAgentUserAction:'observe', aiAgentAutomationAction:'observe', aiAgentFamilyRules:[],
  policyEngineEnabled:true, policyEngineShadowMode:true, policyEngineEnforcementEnabled:false,
  ...overrides
};}
export function runAiAgentCheck({root=ROOT}={}){
  const failures=[];let checks=0;const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};
  check(ANCHORWEIGHT_VERSION==='3.1.0-alpha.3','runtime version must be 3.1.0-alpha.3');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='alpha','release channel must be alpha');
  const ids=[
    ['GPTBot/1.4','openai','gptbot','model_training'],
    ['OAI-SearchBot/1.4','openai','oai-searchbot','search_indexing'],
    ['ChatGPT-User/1.0','openai','chatgpt-user','user_retrieval'],
    ['ClaudeBot/1.0','anthropic','claudebot','model_training'],
    ['Claude-SearchBot/1.0','anthropic','claude-searchbot','search_indexing'],
    ['Claude-User/1.0','anthropic','claude-user','user_retrieval'],
    ['PerplexityBot/1.0','perplexity','perplexitybot','search_indexing'],
    ['Perplexity-User/1.0','perplexity','perplexity-user','user_retrieval'],
    ['Google-Agent','google','google-agent','user_retrieval'],
    ['Google-GeminiNotebook','google','google-gemininotebook','user_retrieval']
  ];
  for(const [ua,provider,family,purpose] of ids){const id=observeTrafficIdentity(req(ua));check(id.provider===provider && id.family===family && id.purpose===purpose,`${ua} identity mapping changed`);}
  const shadow=evaluateAiAgentRequestPolicy(req('GPTBot/1.4'),base({aiAgentTrainingAction:'deny'}));
  check(shadow.action==='deny' && shadow.enforcement==='shadow_only' && !shadow.enforcementEligible,'training deny must be shadow-only by default');
  const active=evaluateAiAgentRequestPolicy(req('GPTBot/1.4'),base({aiAgentTrainingAction:'deny',aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}));
  check(active.enforcementEligible===true && active.enforcement==='deny','explicit AI-agent enforcement must make declared training deny eligible');
  check(active.trustGranted===false,'AI-agent policy must never grant trust from User-Agent declaration');
  const robots=evaluateAiAgentRequestPolicy(req('GPTBot/1.4'),base({aiAgentTrainingAction:'deny',aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}),{pathname:'/robots.txt'});
  check(robots.enforcementEligible===false && robots.reason==='robots_discovery_allowed','robots.txt discovery must not be blocked by the request gate');
  const allowed=evaluateAiAgentRequestPolicy(req('OAI-SearchBot/1.4'),base({aiAgentSearchAction:'allow',aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}));
  check(allowed.action==='allow' && allowed.trustGranted===false && !allowed.enforcementEligible,'allow must not become a trust bypass');
  const family=evaluateAiAgentRequestPolicy(req('ChatGPT-User/1.0'),base({aiAgentUserAction:'allow',aiAgentFamilyRules:['openai:chatgpt-user=deny'],aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}));
  check(family.action==='deny' && family.enforcementEligible===true,'family override must win over purpose default');
  const generated=buildAiAgentRobots(base({aiAgentTrainingAction:'deny'}));
  check(generated.includes('User-agent: GPTBot') && generated.includes('User-agent: ClaudeBot') && generated.includes('User-agent: Google-Extended'),'training deny robots guidance must cover OpenAI, Anthropic, and Google-Extended');
  check(!generated.includes('User-agent: Googlebot\n'),'Google-Extended policy must not accidentally block Google Search');
  const desc=describeAiAgentPolicy(base());
  check(desc.allowGrantsTrust===false && desc.denyRequiresTrustedClientIdentity===false,'descriptor safety semantics changed');
  const passport=createAgentPassport(base());
  check(passport.capabilities?.aiAgentControls?.version===3,'Agent Passport must publish AI Agent Controls v3');
  check(passport.capabilities?.aiAgentControls?.allowGrantsTrust===false,'Agent Passport must state allow does not grant trust');
  check(passport.privacy?.rawUserAgentExposed===false,'AI Agent Controls must not expose raw User-Agent');
  const source=fs.readFileSync(path.join(root,'src/anchorweight.js'),'utf8');
  check(source.includes('evaluateAiAgentRequestPolicy') && source.includes('ai_agent_policy_deny'),'runtime preflight wiring is missing');
  const configSource=fs.readFileSync(path.join(root,'src/config.js'),'utf8');
  check(configSource.includes('AW_AI_AGENT_POLICY_ENABLED') && configSource.includes('AW_AI_AGENT_FAMILY_RULES'),'AI-agent environment configuration wiring is missing');
  const schemaSource=fs.readFileSync(path.join(root,'src/config-schema.js'),'utf8');
  check(schemaSource.includes('aiAgentTrainingAction') && schemaSource.includes('provider:family=allow|observe|deny'),'AI-agent configuration validation wiring is missing');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  check(pkg.scripts?.['ai-agents:check']==='node scripts/ai-agent-check.js' && pkg.scripts?.['ai-agents:robots']==='node scripts/ai-agent-robots.js','package scripts for AI Agent Controls are missing');
  return {ok:failures.length===0,checks,failures};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=runAiAgentCheck();
 if(!result.ok){for(const f of result.failures)console.error('FAIL:',f);process.exit(1);}
 console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} AI Agent Controls PASS (${result.checks} invariants checked)`);
}
