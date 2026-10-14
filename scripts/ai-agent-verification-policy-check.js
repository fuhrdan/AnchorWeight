#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { applyAiAgentVerificationPolicy, parseAiAgentVerificationRules, describeAiAgentVerificationPolicy } from '../src/ai-agent-verification-policy.js';
import { createAgentPassport } from '../src/agent-passport.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');
function base(overrides={}){return {matched:true,enabled:true,action:'observe',enforcement:'observe',enforcementEligible:false,trustGranted:false,provider:'openai',family:'oai-searchbot',purpose:'search_indexing',...overrides};}
function cfg(overrides={}){return {aiAgentPolicyShadowMode:true,aiAgentPolicyEnforcementEnabled:false,aiAgentVerificationRules:[],...overrides};}
function ver(status){return {status,provider:'openai',family:'oai-searchbot',verified:status==='verified',trustGranted:false};}

export function runAiAgentVerificationPolicyCheck({root=ROOT}={}) {
  const failures=[];let checks=0;const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};
  check(ANCHORWEIGHT_VERSION==='3.1.0-alpha.3','runtime version must be 3.1.0-alpha.3');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='alpha','release channel must be alpha');
  const parsed=parseAiAgentVerificationRules(['openai:oai-searchbot@verified=allow','openai:oai-searchbot@unverified=deny']);
  check(parsed.rules.size===2 && parsed.invalid.length===0,'verification rule parser failed');
  check(parseAiAgentVerificationRules(['bad']).invalid.length===1,'invalid verification rules must be bounded');
  const inherited=applyAiAgentVerificationPolicy(base({action:'deny',enforcement:'shadow_only'}),ver('verified'),cfg());
  check(inherited.action==='deny' && inherited.policySource==='declaration_policy','no verification rule must preserve declaration policy');
  const allow=applyAiAgentVerificationPolicy(base(),ver('verified'),cfg({aiAgentVerificationRules:['openai:oai-searchbot@verified=allow']}));
  check(allow.action==='allow' && allow.enforcement==='allow_without_trust','verified allow rule failed');
  check(allow.trustGranted===false,'verified allow must not grant trust');
  const denyShadow=applyAiAgentVerificationPolicy(base(),ver('unverified'),cfg({aiAgentVerificationRules:['openai:oai-searchbot@unverified=deny']}));
  check(denyShadow.action==='deny' && denyShadow.enforcement==='shadow_only' && !denyShadow.enforcementEligible,'unverified deny must remain shadow-first');
  const denyActive=applyAiAgentVerificationPolicy(base(),ver('unverified'),cfg({aiAgentVerificationRules:['openai:oai-searchbot@unverified=deny'],aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}));
  check(denyActive.enforcement==='deny' && denyActive.enforcementEligible===true,'explicit unverified deny enforcement failed');
  const robots=applyAiAgentVerificationPolicy(base(),ver('unverified'),cfg({aiAgentVerificationRules:['openai:oai-searchbot@unverified=deny'],aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}),{pathname:'/robots.txt'});
  check(!robots.enforcementEligible && robots.reason==='robots_discovery_allowed','verification policy must keep robots.txt readable');
  const unavailable=applyAiAgentVerificationPolicy(base({action:'deny',enforcement:'shadow_only'}),ver('unavailable'),cfg({aiAgentVerificationRules:['openai:oai-searchbot@verified=allow']}));
  check(unavailable.action==='deny' && unavailable.policySource==='declaration_policy','unavailable verification must fall back to declaration policy');
  const unavailableRule=applyAiAgentVerificationPolicy(base(),ver('unavailable'),cfg({aiAgentVerificationRules:['openai:oai-searchbot@unavailable=deny']}));
  check(unavailableRule.action==='deny' && unavailableRule.verificationPolicyMatched===true,'explicit unavailable rule failed');
  const unrelated=applyAiAgentVerificationPolicy(base({provider:'openai',family:'gptbot'}),ver('verified'),cfg({aiAgentVerificationRules:['openai:oai-searchbot@verified=allow']}));
  check(unrelated.action==='observe' && !unrelated.verificationPolicyMatched,'family-scoped verification rule overmatched');
  const desc=describeAiAgentVerificationPolicy(cfg());
  check(desc.defaultBehavior==='inherit_declaration_policy','descriptor must preserve declaration policy by default');
  check(desc.verifiedAutomaticallyAllowed===false && desc.unverifiedAutomaticallyDenied===false,'descriptor must not invent implicit trust/blocking');
  check(desc.allowGrantsTrust===false,'descriptor allow must not grant trust');
  const passport=createAgentPassport({});
  check(passport.capabilities?.aiAgentControls?.version===3,'Agent Passport must publish AI Agent Controls v3');
  check(passport.capabilities?.aiAgentControls?.verificationAwarePolicy?.available===true,'passport must publish verification-aware policy');
  check(passport.capabilities?.aiAgentControls?.verificationAwarePolicy?.allowGrantsTrust===false,'passport must preserve no-trust invariant');
  for(const file of ['src/ai-agent-verification-policy.js','test/unit/ai-agent-verification-policy.test.js','VERIFICATION-AWARE-AI-POLICY.md','V3.1.0-ALPHA3-RELEASE-NOTES.md'])
    check(fs.existsSync(path.join(root,file)),`missing alpha.3 artifact ${file}`);
  const anchor=fs.readFileSync(path.join(root,'src/anchorweight.js'),'utf8');
  check(anchor.includes('applyAiAgentVerificationPolicy') && anchor.includes('verificationPolicyMatched'),'runtime verification-aware policy wiring is missing');
  const config=fs.readFileSync(path.join(root,'src/config.js'),'utf8');
  check(config.includes('AW_AI_AGENT_VERIFICATION_RULES'),'verification policy environment wiring is missing');
  const schema=fs.readFileSync(path.join(root,'src/config-schema.js'),'utf8');
  check(schema.includes('aiAgentVerificationRules') && schema.includes('@verified'),'verification policy schema wiring is missing');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  check(pkg.scripts?.['ai-agents:policy-check']==='node scripts/ai-agent-verification-policy-check.js','verification-aware policy check script missing');
  return {ok:failures.length===0,checks,failures};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const r=runAiAgentVerificationPolicyCheck();
  if(!r.ok){for(const f of r.failures)console.error('FAIL:',f);process.exit(1);}
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} Verification-Aware AI Policy PASS (${r.checks} invariants checked)`);
}
