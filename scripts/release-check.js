#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ANCHORWEIGHT_VERSION } from '../src/version.js';
import { runRcHardeningCheck } from './rc-hardening-check.js';
import { runBurnInStaticCheck } from './burn-in-check.js';
import { runFinalReleaseCheck } from './final-release-check.js';
import { runAiAgentCheck } from './ai-agent-check.js';
import { runAiAgentVerificationCheck } from './ai-agent-verification-check.js';
import { runAiAgentVerificationPolicyCheck } from './ai-agent-verification-policy-check.js';
import { runAiAgentObservabilityCheck } from './ai-agent-observability-check.js';
import { runAiAgentPolicyManagerCheck } from './ai-agent-policy-manager-check.js';
import { runAiAgentPolicyDeploymentCheck } from './ai-agent-policy-deployment-check.js';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const required=['scripts/test-suite.js','TESTING-CONSTRAINED-HOSTS.md','README.md','SECURITY.md','ARCHITECTURE.md','THREAT-MODEL.md','CONFIGURATION.md','OPERATIONS.md','DEPLOYMENT.md','CLI.md','LICENSE','DISTRIBUTED-INTELLIGENCE.md','OPERATOR-GATEWAY.md','public/setup.html','src/setup.js','src/telemetry.js','src/gateway-policy.js','src/upstream-health.js','GATEWAY-PROTECTION.md','MULTI-ORIGIN-ROUTING.md','src/routing.js','test/unit/routing.test.js','test/multi-origin.integration.test.js','hub.js','src/declarative-config.js','test/unit/declarative-config.test.js','test/declarative-config.integration.test.js','DECLARATIVE-CONFIGURATION.md','APPLICATION-AUTH.md','src/app-auth.js','bin/app-auth.js','test/unit/app-auth.test.js','test/app-auth.integration.test.js','src/resilience.js','test/unit/resilience.test.js','test/resilience.integration.test.js','UPSTREAM-RESILIENCE.md','LIVE-TRAFFIC-OBSERVATORY.md','src/live-observatory.js','test/unit/live-observatory.test.js','test/live-observatory.integration.test.js','src/alerts.js','bin/alerts.js','test/unit/alerts.test.js','test/alerts.integration.test.js','ALERTS-AND-WEBHOOKS.md','config/examples/alerts-basic.json','INSTALLATION-AND-OPERATIONS.md','bin/operator.js','src/operator-experience.js','test/unit/operator-experience.test.js','test/operator-experience.integration.test.js','src/client-environment.js','test/unit/client-environment.test.js','CLIENT-ENVIRONMENT.md','ADAPTIVE-DECEPTION.md','src/adaptive-deception.js','test/unit/adaptive-deception.test.js','ADAPTIVE-INTERVENTION.md','src/adaptive-intervention.js','test/unit/adaptive-intervention.test.js','CLIENT-IDENTITY-SAFETY.md','src/client-identity.js','test/unit/client-identity.test.js','test/unit/client-identity-integration.test.js','test/unit/proxy-identity-safety.test.js','AGENT-IDENTITY.md','src/agent-identity.js','test/unit/agent-identity.test.js','test/unit/agent-identity-integration.test.js','AGENT-BEHAVIOR.md','src/agent-behavior.js','test/unit/agent-behavior.test.js','test/unit/agent-behavior-integration.test.js','TRAFFIC-SCORING.md','src/traffic-scoring.js','test/unit/traffic-scoring.test.js','test/unit/traffic-scoring-integration.test.js','AGENT-TRAFFIC-OBSERVATORY.md','src/agent-observatory.js','test/unit/agent-observatory.test.js','test/unit/agent-observatory-integration.test.js','AGENT-PASSPORT.md','src/agent-passport.js','test/unit/agent-passport.test.js','test/unit/agent-passport-integration.test.js','CLIENT-ENVIRONMENT-2.md','test/unit/client-environment-2.test.js','test/unit/client-environment-2-integration.test.js','test/unit/agent-passport-routing.test.js','RESOURCE-BUDGETS.md','src/resource-budgets.js','test/unit/resource-budgets.test.js','test/unit/resource-budgets-integration.test.js','test/unit/resource-budgets-observatory.test.js','POLICY-ENGINE.md','src/policy-engine.js','test/unit/policy-engine.test.js','test/unit/policy-engine-integration.test.js','test/unit/policy-engine-observatory.test.js','POLICY-FORENSICS.md','src/policy-forensics.js','test/unit/policy-forensics.test.js','test/unit/policy-forensics-integration.test.js','POLICY-SIMULATION.md','src/policy-simulation.js','test/unit/policy-simulation.test.js','test/unit/policy-simulation-store.test.js','src/version.js','src/release-readiness.js','RELEASE-READINESS.md','VERSION-OWNERSHIP.md','test/unit/version.test.js','test/unit/release-readiness.test.js','test/unit/release-readiness-integration.test.js','ENFORCEMENT-REHEARSAL.md','BETA7-RELEASE-NOTES.md','src/enforcement-rehearsal.js','test/unit/enforcement-rehearsal.test.js','test/unit/enforcement-rehearsal-integration.test.js','scripts/rc-hardening-check.js','test/unit/rc-hardening.test.js','RELEASE-CANDIDATE-HARDENING.md','RC1-RELEASE-NOTES.md','RC1-FROZEN-CONTRACT.json','scripts/burn-in-check.js','test/unit/burn-in-check.test.js','PRODUCTION-BURN-IN.md','RC2-RELEASE-NOTES.md','scripts/final-release-check.js','test/unit/final-release-check.test.js','FINAL-RELEASE-CHECKLIST.md','V3.0.0-RELEASE-NOTES.md','src/ai-agent-policy.js','scripts/ai-agent-check.js','scripts/ai-agent-robots.js','test/unit/ai-agent-policy.test.js','test/unit/ai-agent-identity-v31.test.js','AI-AGENT-CONTROLS.md','V3.1.0-ALPHA1-RELEASE-NOTES.md','src/ai-agent-verification.js','scripts/ai-agent-verification-check.js','test/unit/ai-agent-verification.test.js','VERIFIED-AI-AGENTS.md','V3.1.0-ALPHA2-RELEASE-NOTES.md','src/ai-agent-verification-policy.js','scripts/ai-agent-verification-policy-check.js','test/unit/ai-agent-verification-policy.test.js','VERIFICATION-AWARE-AI-POLICY.md','V3.1.0-ALPHA3-RELEASE-NOTES.md','src/ai-agent-traffic-observatory.js','scripts/ai-agent-observability-check.js','test/unit/ai-agent-traffic-observatory.test.js','test/unit/ai-agent-observability-integration.test.js','AI-AGENT-OBSERVABILITY.md','V3.1.0-ALPHA4-RELEASE-NOTES.md','src/ai-agent-policy-manager.js','scripts/ai-agent-policy-manager-check.js','test/unit/ai-agent-policy-manager.test.js','test/unit/ai-agent-policy-manager-integration.test.js','AI-AGENT-POLICY-MANAGER.md','V3.1.0-ALPHA5-RELEASE-NOTES.md','src/ai-agent-policy-deployment.js','scripts/ai-agent-policy-deployment-check.js','test/unit/ai-agent-policy-deployment.test.js','test/unit/ai-agent-policy-deployment-integration.test.js','AI-AGENT-POLICY-DEPLOYMENT.md','V3.1.0-ALPHA6-RELEASE-NOTES.md'];
const failures=[];
if (ANCHORWEIGHT_VERSION.includes('-rc.')) {
  const rc=runRcHardeningCheck({root});
  for(const failure of rc.failures) failures.push(`RC hardening: ${failure}`);
}
if (ANCHORWEIGHT_VERSION === '3.0.0-rc.2') {
  const burnin=runBurnInStaticCheck({root});
  for(const failure of burnin.failures) failures.push(`RC.2 burn-in: ${failure}`);
}
if (ANCHORWEIGHT_VERSION === '3.0.0') {
  const final=runFinalReleaseCheck({root});
  for(const failure of final.failures) failures.push(`Final release: ${failure}`);
}
if (ANCHORWEIGHT_VERSION.startsWith('3.1.0-alpha.')) {
  const ai=runAiAgentCheck({root});
  for(const failure of ai.failures) failures.push(`AI Agent Controls: ${failure}`);
}
if (['3.1.0-alpha.6','3.1.0-alpha.6'].includes(ANCHORWEIGHT_VERSION)) {
  const verification=await runAiAgentVerificationCheck({root});
  for(const failure of verification.failures) failures.push(`AI Agent Verification: ${failure}`);
}
if (ANCHORWEIGHT_VERSION === '3.1.0-alpha.6') {
  const policy=runAiAgentVerificationPolicyCheck({root});
  for(const failure of policy.failures) failures.push(`Verification-Aware AI Policy: ${failure}`);
}
if (ANCHORWEIGHT_VERSION === '3.1.0-alpha.6') {
  const observability=runAiAgentObservabilityCheck({root});
  for(const failure of observability.failures) failures.push(`AI Agent Observability: ${failure}`);
}
if (ANCHORWEIGHT_VERSION === '3.1.0-alpha.6') {
  const manager=runAiAgentPolicyManagerCheck({root});
  for(const failure of manager.failures) failures.push(`AI Agent Policy Manager: ${failure}`);
}
if (ANCHORWEIGHT_VERSION === '3.1.0-alpha.6') {
  const deployment=runAiAgentPolicyDeploymentCheck({root});
  for(const failure of deployment.failures) failures.push(`AI Agent Policy Deployment: ${failure}`);
}
function runtimeVersionFiles(){
  const out=['app.js','hub.js'];
  for(const dir of ['src','bin','public']){
    const base=path.join(root,dir); if(!fs.existsSync(base))continue;
    for(const entry of fs.readdirSync(base,{withFileTypes:true})){
      if(!entry.isFile())continue;
      if(!/\.(?:js|html)$/.test(entry.name))continue;
      const rel=dir+'/'+entry.name;
      if(rel==='src/version.js')continue;
      out.push(rel);
    }
  }
  return out;
}
for(const entry of runtimeVersionFiles()){
  const source=fs.readFileSync(path.join(root,entry),'utf8');
  for(const match of source.match(/3\.\d+\.\d+-(?:alpha|beta|rc)\.\d+/g)||[]){
    if(match!==ANCHORWEIGHT_VERSION) failures.push('stale runtime version '+match+' remains in '+entry+'; expected '+ANCHORWEIGHT_VERSION);
  }
}
if(pkg.version!==ANCHORWEIGHT_VERSION) failures.push(`package version is ${pkg.version}; expected ${ANCHORWEIGHT_VERSION}`);
for(const file of required) if(!fs.existsSync(path.join(root,file))) failures.push(`missing ${file}`);
for (const entry of ['app.js','hub.js']) { try { execFileSync(process.execPath,['--check',path.join(root,entry)],{stdio:'pipe'}); } catch { failures.push(`${entry} syntax check failed`); } }
try { const cli=execFileSync(process.execPath,[path.join(root,'bin/anchorweight.js'),'version'],{encoding:'utf8'}).trim(); if(cli!==ANCHORWEIGHT_VERSION) failures.push(`CLI version is ${cli}; expected ${ANCHORWEIGHT_VERSION}`); } catch { failures.push('CLI version command failed'); }
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
if(lock.version!==ANCHORWEIGHT_VERSION || lock.packages?.['']?.version!==ANCHORWEIGHT_VERSION) failures.push('package-lock version mismatch');

const VERIFY=process.argv.includes('--verify');
if (process.argv.some(arg=>arg.startsWith('--') && arg!=='--verify')) failures.push('unsupported release-check argument');
const files=[];
const ignoredDirs=new Set(['.git','data','backups','reports','node_modules','tmp','coverage','.cache']);
const ignoredFiles=new Set(['SOURCE-MANIFEST.json','SOURCE-REVIEW.txt','main']);
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if (ignoredDirs.has(entry.name)||ignoredFiles.has(entry.name)||
        (entry.name.startsWith('.env')&&entry.name!=='.env.example')||
        /\.(?:log|bak|backup|zip|sqlite|sqlite-wal|sqlite-shm)$/.test(entry.name)) continue;
    const fp=path.join(dir,entry.name);
    if(entry.isSymbolicLink()) {failures.push(`symlink in release source: ${path.relative(root,fp)}`);continue;}
    if(entry.isDirectory())walk(fp);
    else if(entry.isFile())files.push(fp);
  }
}
walk(root);
const manifest=files.sort().map(fp=>({file:path.relative(root,fp).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')}));
const expected={version:ANCHORWEIGHT_VERSION,files:manifest};
const manifestFile=path.join(root,'SOURCE-MANIFEST.json');
if (VERIFY) {
  try {
    const current=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    if(JSON.stringify(current)!==JSON.stringify(expected)) failures.push('source manifest mismatch: run release:check and review changes before committing');
  } catch(err){ failures.push(`source manifest unavailable or invalid: ${err.message}`); }
} else if (!failures.length) {
  fs.writeFileSync(manifestFile,JSON.stringify(expected,null,2)+'\n');
}
if(failures.length){for(const f of failures)console.error('FAIL:',f);process.exit(1)}
console.log(`AnchorWeight v${ANCHORWEIGHT_VERSION} release ${VERIFY?'verification':'check'} PASS (${manifest.length} source files manifested)`);
