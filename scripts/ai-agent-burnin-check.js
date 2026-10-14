#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { observeTrafficIdentity } from '../src/agent-identity.js';
import { createAgentPassport } from '../src/agent-passport.js';
import { describeAiAgentPolicyManager } from '../src/ai-agent-policy-manager.js';
import { describeAiAgentPolicyDeployment } from '../src/ai-agent-policy-deployment.js';
import { buildAiAgentBurnInReadiness,describeAiAgentBurnInReadiness } from '../src/ai-agent-burnin-readiness.js';
import { runAiAgentCheck } from './ai-agent-check.js';
import { runAiAgentVerificationCheck } from './ai-agent-verification-check.js';
import { runAiAgentVerificationPolicyCheck } from './ai-agent-verification-policy-check.js';
import { runAiAgentObservabilityCheck } from './ai-agent-observability-check.js';
import { runAiAgentPolicyManagerCheck } from './ai-agent-policy-manager-check.js';
import { runAiAgentPolicyDeploymentCheck } from './ai-agent-policy-deployment-check.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FROZEN_SHA256='85ff04b25499e458898f00c6b4b631764efce9b4ee74b11e1078723e29fa956a';

const CANARIES=Object.freeze([
  ['GPTBot/1.4','openai','gptbot','model_training'],
  ['OAI-SearchBot/1.4','openai','oai-searchbot','search_indexing'],
  ['ChatGPT-User/1.0','openai','chatgpt-user','user_retrieval'],
  ['OAI-AdsBot/1.0','openai','oai-adsbot','general_automation'],
  ['ClaudeBot/1.0','anthropic','claudebot','model_training'],
  ['Claude-SearchBot/1.0','anthropic','claude-searchbot','search_indexing'],
  ['Claude-User/1.0','anthropic','claude-user','user_retrieval'],
  ['PerplexityBot/1.0','perplexity','perplexitybot','search_indexing'],
  ['Perplexity-User/1.0','perplexity','perplexity-user','user_retrieval'],
  ['Google-Agent','google','google-agent','user_retrieval'],
  ['Google-GeminiNotebook','google','google-gemininotebook','user_retrieval'],
  ['Google-CloudVertexBot','google','google-cloudvertexbot','general_automation']
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runtimeSourceFiles(root) {
  const out=['app.js','hub.js'];
  for(const dir of ['src','bin','public']) {
    const base=path.join(root,dir);
    if(!fs.existsSync(base)) continue;
    for(const entry of fs.readdirSync(base,{withFileTypes:true})) {
      if(!entry.isFile() || !/\.(?:js|html)$/.test(entry.name)) continue;
      const rel=`${dir}/${entry.name}`;
      if(rel==='src/version.js') continue;
      out.push(rel);
    }
  }
  return out;
}

export async function runAiAgentBurnInCheck({root=ROOT}={}) {
  const failures=[];let checks=0;
  const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};

  check(ANCHORWEIGHT_VERSION==='3.1.0-rc.1','runtime version must be 3.1.0-rc.1');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='rc','release channel must be beta');

  const prior={
    controls:runAiAgentCheck({root}),
    verification:await runAiAgentVerificationCheck({root}),
    verificationPolicy:runAiAgentVerificationPolicyCheck({root}),
    observability:runAiAgentObservabilityCheck({root}),
    policyManager:runAiAgentPolicyManagerCheck({root}),
    policyDeployment:runAiAgentPolicyDeploymentCheck({root})
  };
  for(const [name,result] of Object.entries(prior)) {
    check(result.ok===true,`${name} gate failed: ${(result.failures||[]).join('; ')}`);
  }

  let canaryPassed=0;
  for(const [ua,provider,family,purpose] of CANARIES) {
    const identity=observeTrafficIdentity({headers:{'user-agent':ua}});
    const ok=identity.declared===true && identity.provider===provider && identity.family===family && identity.purpose===purpose;
    if(ok) canaryPassed++;
    check(ok,`${ua} canary did not resolve to ${provider}:${family}/${purpose}`);
  }

  const contractFile=path.join(root,'RC1-FROZEN-CONTRACT.json');
  const frozenHash=fs.existsSync(contractFile)?sha256(contractFile):'missing';
  check(frozenHash===FROZEN_SHA256,'RC1 frozen contract hash changed');
  let contract={};
  try { contract=JSON.parse(fs.readFileSync(contractFile,'utf8')); }
  catch { check(false,'RC1 frozen contract is not valid JSON'); }

  const passport=createAgentPassport({});
  check(passport.capabilities?.aiAgentControls?.version===10,'Agent Passport must publish AI Agent Controls v7');
  check(passport.capabilities?.aiAgentControls?.burnInReadiness?.available===true,'Agent Passport burn-in readiness capability missing');
  check(passport.capabilities?.aiAgentControls?.burnInReadiness?.enforcementReadinessGranted===false,'burn-in capability must not grant enforcement readiness');

  let privacyPass=true;
  for(const key of (contract.privacyFalseFlags||[])) {
    const ok=passport.privacy?.[key]===false;
    privacyPass=privacyPass&&ok;
    check(ok,`frozen privacy flag changed: ${key}`);
  }
  const policyActionsMatch=JSON.stringify(passport.capabilities?.policyEngine?.actions||[])===JSON.stringify(contract.policyActions||[]);
  check(policyActionsMatch,'frozen policy action ladder changed');

  const observability=passport.capabilities?.aiAgentControls?.observability||{};
  check(observability.enforcement===false,'AI observability must remain non-enforcing');
  check(observability.rawIpRetained===false && observability.rawUserAgentRetained===false,'AI observability privacy contract changed');

  const manager=describeAiAgentPolicyManager();
  check(manager.saveChangesRuntime===false && manager.enforcementControlAvailable===false,'policy manager runtime/enforcement safety changed');
  check(manager.exportForcesShadowMode===true && manager.exportForcesEnforcementDisabled===true,'policy manager export must remain shadow-first');

  const deployment=describeAiAgentPolicyDeployment();
  const shadowDeploymentSafe=deployment.shadowOnlyPreparation===true &&
    deployment.automaticActivation===false &&
    deployment.automaticRestart===false &&
    deployment.changesRuntime===false &&
    deployment.enforcementControlAvailable===false;
  check(shadowDeploymentSafe,'policy deployment safety contract changed');
  check(deployment.rawIpExposed===false && deployment.rawUserAgentExposed===false && deployment.credentialsExposed===false,'policy deployment privacy contract changed');

  const dashboard=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');
  const dashboardContractPass=
    dashboard.includes('AI Agent Access Observatory') &&
    dashboard.includes('AI Agent Policy Manager') &&
    dashboard.includes('Controlled AI Policy Deployment') &&
    dashboard.includes('PREPARE SHADOW DEPLOYMENT') &&
    !dashboard.includes('Enable AI Enforcement');
  check(dashboardContractPass,'AI dashboard operator/safety contract changed');

  const anchor=fs.readFileSync(path.join(root,'src/anchorweight.js'),'utf8');
  const runtimeWiringPass=
    anchor.includes('aiAgentTrafficObservatory.record') &&
    anchor.includes('/api/ai-agents/policy-manager') &&
    anchor.includes('/api/ai-agents/policy-deployment') &&
    anchor.includes('validateCsrf');
  check(runtimeWiringPass,'AI runtime/API wiring incomplete');

  let sourceHygienePass=true;
  for(const rel of runtimeSourceFiles(root)) {
    const source=fs.readFileSync(path.join(root,rel),'utf8');
    const versions=source.match(/3\.\d+\.\d+-(?:alpha|beta|rc)\.\d+/g)||[];
    if(versions.some(v=>v!==ANCHORWEIGHT_VERSION)) {
      sourceHygienePass=false;
      check(false,`stale runtime version remains in ${rel}`);
    }
  }
  check(sourceHygienePass,'runtime source version hygiene failed');

  const releaseSource=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  const releaseVerificationAvailable=
    releaseSource.includes("process.argv.includes('--verify')") &&
    releaseSource.includes('SOURCE-MANIFEST.json') &&
    releaseSource.includes('source manifest mismatch');
  check(releaseVerificationAvailable,'release manifest verification wiring missing');

  const descriptor=describeAiAgentBurnInReadiness();
  check(descriptor.enforcementReadinessGranted===false && descriptor.enforcementControlAvailable===false,'burn-in descriptor must not grant enforcement');
  check(descriptor.changesRuntime===false && descriptor.networkRequired===false,'burn-in gate must be offline and non-mutating');
  check(descriptor.rawIpExposed===false && descriptor.rawUserAgentExposed===false && descriptor.rawPathExposed===false,'burn-in descriptor privacy changed');

  for(const file of [
    'src/ai-agent-burnin-readiness.js',
    'scripts/ai-agent-burnin-check.js',
    'test/unit/ai-agent-burnin-readiness.test.js',
    'test/unit/ai-agent-burnin-integration.test.js',
    'AI-AGENT-BURNIN-READINESS.md',
    'V3.1.0-ALPHA7-RELEASE-NOTES.md'
  ]) check(fs.existsSync(path.join(root,file)),`missing alpha.7 artifact ${file}`);

  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  check(pkg.scripts?.['ai-agents:burnin-check']==='node scripts/ai-agent-burnin-check.js','package burn-in check script missing');

  const readiness=buildAiAgentBurnInReadiness({
    gates:Object.fromEntries(Object.entries(prior).map(([k,v])=>[k,v.ok===true])),
    canaries:{expected:CANARIES.length,passed:canaryPassed},
    frozenContractHashMatches:frozenHash===FROZEN_SHA256,
    privacyInvariantsPass:privacyPass,
    policyActionsMatch,
    shadowDeploymentSafe,
    dashboardContractPass,
    runtimeWiringPass,
    sourceHygienePass,
    releaseVerificationAvailable,
    enforcementEnabled:false
  });
  check(readiness.readyForBetaReview===true,'consolidated burn-in readiness verdict is not beta-review ready');
  check(readiness.enforcementReadinessGranted===false,'beta-review readiness must not grant enforcement readiness');

  return {ok:failures.length===0,checks,failures,readiness,priorGateChecks:Object.fromEntries(Object.entries(prior).map(([k,v])=>[k,v.checks]))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await runAiAgentBurnInCheck();
  if(process.argv.includes('--json')) {
    console.log(JSON.stringify(result,null,2));
    if(!result.ok) process.exit(1);
  } else {
    if(!result.ok){for(const f of result.failures)console.error('FAIL:',f);process.exit(1);}
    console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} AI Agent Burn-In PASS (${result.checks} invariants checked)`);
    console.log('READY FOR v3.1 BETA REVIEW');
  }
}
