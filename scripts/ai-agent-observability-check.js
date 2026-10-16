#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAiAgentTrafficObservatory, describeAiAgentTrafficObservatory } from '../src/ai-agent-traffic-observatory.js';
import { createAgentPassport } from '../src/agent-passport.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');

function decision(overrides={}) {
  return {provider:'openai',family:'oai-searchbot',purpose:'search_indexing',action:'observe',
    enforcement:'observe',enforcementEligible:false,policySource:'declaration_policy',
    verificationPolicyMatched:false,...overrides};
}
function verification(status='verified',overrides={}) {
  return {status,provider:'openai',family:'oai-searchbot',...overrides};
}

export function runAiAgentObservabilityCheck({root=ROOT}={}) {
  const failures=[];let checks=0;
  const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};

  check(ANCHORWEIGHT_VERSION==='3.1.0','runtime version must be 3.1.0');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='stable','release channel must be beta');

  let tick=1;
  const o=createAiAgentTrafficObservatory({now:()=>tick++});
  const empty=o.snapshot();
  check(empty.requests===0,'new AI-agent observatory must start empty');
  check(empty.processLocal===true && empty.resetOnRestart===true,'AI-agent observatory must remain process-local');
  check(empty.enforcement===false,'AI-agent observatory must never enforce');

  o.record(decision({action:'allow',enforcement:'allow_without_trust',policySource:'verification_rule',verificationPolicyMatched:true}),verification('verified'));
  o.record(decision({action:'deny',enforcement:'shadow_only'}),verification('unverified'));
  o.record(decision({provider:'anthropic',family:'claudebot',purpose:'model_training'}),
    verification('unavailable',{provider:'anthropic',family:'claudebot'}));
  o.record(decision({action:'deny',enforcement:'deny',enforcementEligible:true}),verification('verified'));
  const s=o.snapshot();
  check(s.requests===4 && s.declaredRequests===4,'declared AI-agent request total is wrong');
  check(s.verification.verified===2,'verified counter is wrong');
  check(s.verification.unverified===1,'unverified counter is wrong');
  check(s.verification.unavailable===1,'unavailable counter is wrong');
  check(s.actions.allow===1 && s.actions.observe===1 && s.actions.deny===2,'action counters are wrong');
  check(s.outcomes.allowed===1,'allowed outcome counter is wrong');
  check(s.outcomes.observed===1,'observed outcome counter is wrong');
  check(s.outcomes.would_deny===1,'would-deny outcome counter is wrong');
  check(s.outcomes.denied===1,'denied outcome counter is wrong');
  check(s.verificationPolicyMatches===1,'verification-rule match counter is wrong');
  check(s.providers.some(p=>p.provider==='openai'),'OpenAI provider breakdown missing');
  check(s.providers.some(p=>p.provider==='anthropic'),'Anthropic provider breakdown missing');
  check(s.providers.find(p=>p.provider==='openai')?.families.some(f=>f.family==='oai-searchbot'),'family breakdown missing');

  for(let i=0;i<30;i++)o.record(decision(),verification('verified'));
  check(o.snapshot().recent.length===24,'recent AI-agent decisions must be capped at 24');

  const safeText=JSON.stringify(o.snapshot());
  check(!safeText.includes('rawIp') || safeText.includes('"rawIpRetained":false'),'raw IP data appeared in observability snapshot');
  check(!safeText.includes('user-agent'),'raw User-Agent data appeared in observability snapshot');
  check(!safeText.includes('"path"'),'raw path data appeared in observability snapshot');
  check(!safeText.includes('"query"'),'raw query data appeared in observability snapshot');

  const descriptor=describeAiAgentTrafficObservatory();
  check(descriptor.authenticated===true,'observability descriptor must require authenticated presentation');
  check(descriptor.maxRecentDecisions===24,'observability descriptor recent bound changed');
  check(descriptor.rawIpRetained===false && descriptor.rawUserAgentRetained===false,'observability descriptor privacy changed');

  const passport=createAgentPassport({});
  check(passport.capabilities?.aiAgentControls?.version===11,'Agent Passport must publish AI Agent Controls v4');
  check(passport.capabilities?.aiAgentControls?.observability?.available===true,'Agent Passport observability capability missing');
  check(passport.capabilities?.aiAgentControls?.observability?.authenticated===true,'Agent Passport observability must be authenticated');
  check(passport.capabilities?.aiAgentControls?.observability?.enforcement===false,'Agent Passport observability must be non-enforcing');

  for(const file of [
    'src/ai-agent-traffic-observatory.js',
    'test/unit/ai-agent-traffic-observatory.test.js',
    'test/unit/ai-agent-observability-integration.test.js',
    'AI-AGENT-OBSERVABILITY.md',
    'V3.1.0-ALPHA4-RELEASE-NOTES.md'
  ]) check(fs.existsSync(path.join(root,file)),`missing alpha.4 artifact ${file}`);

  const anchor=fs.readFileSync(path.join(root,'src/anchorweight.js'),'utf8');
  check(anchor.includes('createAiAgentTrafficObservatory') && anchor.includes('aiAgentTrafficObservatory.record'),
    'runtime AI-agent observability wiring is missing');
  check(anchor.includes('/api/ai-agents') && anchor.includes('aiAgentTraffic:aiAgentTrafficObservatory.snapshot()'),
    'authenticated AI-agent observability API wiring is missing');

  const dashboard=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');
  check(dashboard.includes('AI Agent Access Observatory'),'dashboard AI-agent panel is missing');
  check(dashboard.includes('renderAiAgentTraffic'),'dashboard AI-agent renderer is missing');
  check(dashboard.includes('aiAgentProviderTable') && dashboard.includes('aiAgentRecentTable'),
    'dashboard AI-agent detail tables are missing');

  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  check(pkg.scripts?.['ai-agents:observability-check']==='node scripts/ai-agent-observability-check.js',
    'AI-agent observability check script missing');

  return {ok:failures.length===0,checks,failures};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const r=runAiAgentObservabilityCheck();
  if(!r.ok){for(const f of r.failures)console.error('FAIL:',f);process.exit(1);}
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} AI Agent Observability PASS (${r.checks} invariants checked)`);
}
