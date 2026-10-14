#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAgentPassport } from '../src/agent-passport.js';
import { describeAiAgentPolicyManager } from '../src/ai-agent-policy-manager.js';
import { describeAiAgentPolicyDeployment } from '../src/ai-agent-policy-deployment.js';
import { runAiAgentBurnInCheck } from './ai-agent-burnin-check.js';
import { buildAiAgentBetaReadiness,describeAiAgentBetaReadiness } from '../src/ai-agent-beta-readiness.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FROZEN_SHA256='85ff04b25499e458898f00c6b4b631764efce9b4ee74b11e1078723e29fa956a';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function betaPrerequisiteReleaseChannel(version=ANCHORWEIGHT_VERSION,channel=ANCHORWEIGHT_RELEASE_CHANNEL) {
  if(version==='3.1.0-rc.1' && channel==='rc') return 'beta';
  return channel;
}

export async function runAiAgentBetaCheck({root=ROOT}={}) {
  const failures=[];let checks=0;
  const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};

  check(ANCHORWEIGHT_VERSION==='3.1.0-rc.1','runtime version must be 3.1.0-rc.1');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='rc','release channel must be beta');

  const burnIn=await runAiAgentBurnInCheck({root});
  check(burnIn.ok===true,`alpha.7 burn-in prerequisite failed: ${(burnIn.failures||[]).join('; ')}`);
  check(burnIn.readiness?.readyForBetaReview===true,'alpha.7 burn-in did not reach beta-review readiness');
  check((burnIn.readiness?.blockers||[]).length===0,'alpha.7 burn-in readiness still has blockers');
  check(burnIn.readiness?.enforcementReadinessGranted===false,'alpha.7 burn-in must not grant enforcement readiness');
  check(burnIn.readiness?.changesRuntime===false,'alpha.7 burn-in must remain non-mutating');

  const contractFile=path.join(root,'RC1-FROZEN-CONTRACT.json');
  const frozenHash=fs.existsSync(contractFile)?sha256(contractFile):'missing';
  check(frozenHash===FROZEN_SHA256,'RC1 frozen contract hash changed');

  let contract={};
  try { contract=JSON.parse(fs.readFileSync(contractFile,'utf8')); }
  catch { check(false,'RC1 frozen contract is not valid JSON'); }

  const passport=createAgentPassport({});
  check(passport.capabilities?.aiAgentControls?.version===10,'Agent Passport must publish AI Agent Controls v8');
  check(passport.capabilities?.aiAgentControls?.betaReadiness?.available===true,'Agent Passport beta readiness capability missing');
  check(passport.capabilities?.aiAgentControls?.betaReadiness?.enforcementReadinessGranted===false,'beta readiness capability must not grant enforcement readiness');
  check(passport.capabilities?.aiAgentControls?.betaReadiness?.enforcementControlAvailable===false,'beta readiness capability must not expose enforcement control');

  let privacyPass=true;
  for(const key of (contract.privacyFalseFlags||[])) {
    const ok=passport.privacy?.[key]===false;
    privacyPass=privacyPass&&ok;
    check(ok,`frozen privacy flag changed: ${key}`);
  }
  check(JSON.stringify(passport.capabilities?.policyEngine?.actions||[])===JSON.stringify(contract.policyActions||[]),'frozen policy action ladder changed');

  const manager=describeAiAgentPolicyManager();
  const deployment=describeAiAgentPolicyDeployment();
  const shadowSafetyPass=
    manager.saveChangesRuntime===false &&
    manager.enforcementControlAvailable===false &&
    manager.exportForcesShadowMode===true &&
    manager.exportForcesEnforcementDisabled===true &&
    deployment.shadowOnlyPreparation===true &&
    deployment.automaticActivation===false &&
    deployment.automaticRestart===false &&
    deployment.changesRuntime===false &&
    deployment.enforcementControlAvailable===false;
  check(shadowSafetyPass,'policy manager/deployment shadow-safety contract changed');

  const dashboard=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');
  const operatorSurfacePass=
    dashboard.includes('AI Agent Access Observatory') &&
    dashboard.includes('AI Agent Policy Manager') &&
    dashboard.includes('Controlled AI Policy Deployment') &&
    dashboard.includes('PREPARE SHADOW DEPLOYMENT') &&
    !dashboard.includes('Enable AI Enforcement');
  check(operatorSurfacePass,'dashboard/operator safety contract changed');

  const releaseSource=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  const releaseVerificationAvailable=
    releaseSource.includes("process.argv.includes('--verify')") &&
    releaseSource.includes('SOURCE-MANIFEST.json') &&
    releaseSource.includes('source manifest mismatch') &&
    releaseSource.includes('runAiAgentBetaCheck');
  check(releaseVerificationAvailable,'release verification/beta gate wiring missing');

  const betaDocumentationComplete=[
    'AI-AGENT-BETA-VALIDATION.md',
    'V3.1.0-BETA1-RELEASE-NOTES.md'
  ].every(file=>fs.existsSync(path.join(root,file)));
  check(betaDocumentationComplete,'beta validation/release documentation missing');

  const descriptor=describeAiAgentBetaReadiness();
  check(descriptor.stabilizationOnly===true && descriptor.requiresAlphaBurnIn===true,'beta readiness descriptor must be stabilization-only and require alpha burn-in');
  check(descriptor.enforcementReadinessGranted===false && descriptor.enforcementControlAvailable===false,'beta readiness descriptor must not grant enforcement authority');
  check(descriptor.changesRuntime===false && descriptor.networkRequired===false,'beta readiness gate must remain offline and non-mutating');
  check(descriptor.rawIpExposed===false && descriptor.rawUserAgentExposed===false && descriptor.rawPathExposed===false && descriptor.rawQueryExposed===false,'beta readiness privacy descriptor changed');

  for(const file of [
    'src/ai-agent-beta-readiness.js',
    'scripts/ai-agent-beta-check.js',
    'test/unit/ai-agent-beta-readiness.test.js',
    'test/unit/ai-agent-beta-integration.test.js',
    'AI-AGENT-BETA-VALIDATION.md',
    'V3.1.0-BETA1-RELEASE-NOTES.md'
  ]) check(fs.existsSync(path.join(root,file)),`missing beta.1 artifact ${file}`);

  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  check(pkg.scripts?.['ai-agents:beta-check']==='node scripts/ai-agent-beta-check.js','package beta check script missing');

  const readiness=buildAiAgentBetaReadiness({
    releaseChannel:betaPrerequisiteReleaseChannel(),
    burnIn:{
      ok:burnIn.ok===true,
      readyForBetaReview:burnIn.readiness?.readyForBetaReview===true,
      blockers:burnIn.readiness?.blockers||[]
    },
    frozenContractHashMatches:frozenHash===FROZEN_SHA256,
    privacyInvariantsPass:privacyPass,
    shadowSafetyPass,
    operatorSurfacePass,
    releaseVerificationAvailable,
    betaDocumentationComplete,
    activeEnforcementControlExposed:false,
    changesRuntime:false
  });
  check(readiness.readyForBetaValidation===true,'consolidated beta readiness verdict is not ready for beta validation');
  check(readiness.enforcementReadinessGranted===false,'beta validation readiness must not grant enforcement readiness');

  return {
    ok:failures.length===0,
    checks,
    failures,
    readiness,
    alphaBurnIn:{checks:burnIn.checks,canaries:burnIn.readiness?.canaries||null}
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await runAiAgentBetaCheck();
  if(process.argv.includes('--json')) {
    console.log(JSON.stringify(result,null,2));
    if(!result.ok) process.exit(1);
  } else {
    if(!result.ok){for(const f of result.failures)console.error('FAIL:',f);process.exit(1);}
    console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} AI Agent Beta Stabilization PASS (${result.checks} invariants checked)`);
    if(ANCHORWEIGHT_RELEASE_CHANNEL==='rc')
      console.log('BETA PREREQUISITE PRESERVED FOR v3.1 RC');
    else
      console.log('READY FOR v3.1 BETA VALIDATION');
    console.log('Active AI deny enforcement remains a separate explicit operator decision.');
  }
}
