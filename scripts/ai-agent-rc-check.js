#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION,ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAgentPassport } from '../src/agent-passport.js';
import { buildAiAgentRcReadiness,describeAiAgentRcReadiness } from '../src/ai-agent-rc-readiness.js';
import { runAiAgentBeta2Check } from './ai-agent-beta2-check.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FROZEN_SHA256='85ff04b25499e458898f00c6b4b631764efce9b4ee74b11e1078723e29fa956a';
const BASELINE_COMMIT='3472fee0bb4e46d7483b9845688b0719836a1e9a';
const CRITICAL_BLOBS={
  "src/anchorweight.js": "24f3ed886fef80675e1935378e9efe4e1e6cebb3",
  "src/ai-agent-policy.js": "17078f8751c4eb086bd9ccfa1f3aecb04a166f05",
  "src/ai-agent-verification.js": "e4dd932caefb2819f8732f1575024193b5e1f1e7",
  "src/ai-agent-verification-policy.js": "57414ed19efb97796b2448f7f1679b22732ff495",
  "src/config.js": "d275ba238f0bae518b81d35edcafb09a017bd6f1",
  "src/config-schema.js": "a933cc5fe8a04999ad5b6605b9bb39264eab147a"
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function gitBlobSha(file) {
  const data=fs.readFileSync(file);
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${data.length}\0`),data])).digest('hex');
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

export async function runAiAgentRcCheck({root=ROOT}={}) {
  const failures=[];let checks=0;
  const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};

  check(ANCHORWEIGHT_VERSION==='3.1.0','runtime version must be 3.1.0');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='stable','release channel must be rc');

  const beta2=await runAiAgentBeta2Check({root});
  check(beta2.ok===true,`beta.2 validated-source prerequisite failed: ${(beta2.failures||[]).join('; ')}`);
  check((beta2.failures||[]).length===0,'beta.2 prerequisite failures must remain empty');

  const frozen=path.join(root,'RC1-FROZEN-CONTRACT.json');
  const frozenMatches=fs.existsSync(frozen)&&sha256(frozen)===FROZEN_SHA256;
  check(frozenMatches,'frozen v3 contract hash changed');

  let record=null;
  try { record=readJson(path.join(root,'V3.1-RC1-VALIDATION-RECORD.json')); }
  catch(err) { failures.push(`validation record unavailable: ${err.message}`); }
  const recordValid=!!record &&
    record.schema==='anchorweight-v31-rc1-validation-record/v1' &&
    record.baselineVersion==='3.1.0-beta.2' &&
    record.baselineTag==='v3.1.0-beta.2-validated' &&
    record.baselineCommit===BASELINE_COMMIT &&
    record.evidence?.publicProductionShadowValidation===true &&
    record.evidence?.authenticatedOperatorValidation===true &&
    record.evidence?.liveAiCanaries?.passed===12 &&
    record.evidence?.liveAiCanaries?.expected===12 &&
    record.evidence?.restartComparisonPassed===true &&
    record.evidence?.readyForRcReview===true &&
    record.evidence?.privacyScannerRegressionPassed===true &&
    record.productionSafety?.globalShadowMode===true &&
    record.productionSafety?.aiAgentPolicyEnforced===false &&
    record.secretsRecorded===false &&
    record.rawClientDataRecorded===false;
  check(recordValid,'validated beta.2 production evidence record is invalid');

  let requestPathUnchanged=true;
  for(const [rel,expected] of Object.entries(CRITICAL_BLOBS)) {
    const file=path.join(root,rel);
    const actual=fs.existsSync(file)?gitBlobSha(file):null;
    check(actual===expected,`validated beta.2 request-path blob changed: ${rel}`);
    if(actual!==expected) requestPathUnchanged=false;
  }

  const passport=createAgentPassport({
    basePath:'/anchor',shadowMode:true,scoreEnforcementEnabled:false,
    policyEngineEnabled:true,policyEngineShadowMode:true,policyEngineEnforcementEnabled:false,
    aiAgentPolicyEnabled:true,aiAgentPolicyShadowMode:true,aiAgentPolicyEnforcementEnabled:false
  });
  const ai=passport.capabilities?.aiAgentControls;
  check(ai?.version===11,'Agent Passport must publish AI Agent Controls v10');
  check(ai?.rcReadiness?.available===true,'Agent Passport RC readiness descriptor missing');
  check(ai?.rcReadiness?.enforcementReadinessGranted===false,'RC readiness must grant no enforcement readiness');
  check(ai?.rcReadiness?.enforcementControlAvailable===false,'RC readiness must expose no enforcement control');
  check(ai?.productionValidation?.restartComparisonAvailable===true,'production validation must expose restart comparison availability');
  check(ai?.productionValidation?.restartComparisonRequiredForRcReview===true,'restart comparison must remain required for RC review');
  check(passport.enforcement?.aiAgentPolicyEnforced===false,'AI Agent Policy must remain non-enforcing by default');
  check(passport.privacy?.rawIpExposed===false && passport.privacy?.rawUserAgentExposed===false &&
        passport.privacy?.rawPathExposed===false && passport.privacy?.rawQueryExposed===false &&
        passport.privacy?.credentialsExposed===false,'public privacy invariants changed');

  const configSource=fs.readFileSync(path.join(root,'src/config.js'),'utf8');
  const shadowSafetyPass=
    configSource.includes("aiAgentPolicyShadowMode: boolEnv('AW_AI_AGENT_POLICY_SHADOW_MODE', true)") &&
    configSource.includes("aiAgentPolicyEnforcementEnabled: boolEnv('AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED', false)");
  check(shadowSafetyPass,'AI-agent shadow/enforcement defaults changed');

  const productionSource=fs.readFileSync(path.join(root,'scripts/ai-agent-production-check.js'),'utf8');
  const productionValidationSemanticsPass=
    productionSource.includes("ai?.version===11") &&
    productionSource.includes('val!==false && val!==null') &&
    productionSource.includes("headers:{'User-Agent':'GPTBot/1.4'}") &&
    productionSource.includes('robotsPolicyAccessible') &&
    productionSource.includes('AW_PRODUCTION_DASHBOARD_TOKEN') &&
    productionSource.includes('--capture') &&
    productionSource.includes('--compare');
  check(productionValidationSemanticsPass,'production validator RC safety semantics changed');

  const descriptor=describeAiAgentRcReadiness();
  check(descriptor.stabilizationOnly===true && descriptor.changesRuntime===false,'RC readiness descriptor must remain stabilization-only/non-mutating');
  check(descriptor.enforcementReadinessGranted===false && descriptor.enforcementControlAvailable===false,'RC readiness descriptor enforcement safety changed');
  check(descriptor.networkRequired===false,'RC static gate must remain offline');

  const required=[
    'src/ai-agent-rc-readiness.js','scripts/ai-agent-rc-check.js',
    'test/unit/ai-agent-rc-readiness.test.js','test/unit/ai-agent-rc-integration.test.js',
    'AI-AGENT-RC-READINESS.md','V3.1.0-RC1-RELEASE-NOTES.md','V3.1-RC1-VALIDATION-RECORD.json'
  ];
  let documentationComplete=true;
  for(const rel of required) {
    const exists=fs.existsSync(path.join(root,rel));
    check(exists,`missing RC.1 artifact ${rel}`);
    if(!exists) documentationComplete=false;
  }

  const pkg=readJson(path.join(root,'package.json'));
  check(pkg.scripts?.['ai-agents:rc-check']==='node scripts/ai-agent-rc-check.js','package RC check script missing');
  const releaseSource=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  const releaseVerificationAvailable=releaseSource.includes('runAiAgentRcCheck') &&
    releaseSource.includes('AI Agent RC Readiness') &&
    releaseSource.includes('SOURCE-MANIFEST.json');
  check(releaseVerificationAvailable,'release-check RC readiness wiring missing');

  const privacyInvariantsPass=
    ai?.rcReadiness?.rawIpExposed===false &&
    ai?.rcReadiness?.rawUserAgentExposed===false &&
    ai?.rcReadiness?.rawPathExposed===false &&
    ai?.rcReadiness?.rawQueryExposed===false &&
    ai?.rcReadiness?.credentialsExposed===false;
  check(privacyInvariantsPass,'RC readiness privacy descriptor changed');

  const readiness=buildAiAgentRcReadiness({
    rcStaticReady:true,
    priorBeta2GatePassed:beta2.ok===true,
    validatedBaselineRecord:recordValid,
    frozenContractHashMatches:frozenMatches,
    requestPathUnchanged,
    privacyInvariantsPass,
    shadowSafetyPass,
    productionValidationSemanticsPass,
    releaseVerificationAvailable,
    documentationComplete,
    enforcementControlAvailable:false,
    changesRuntime:false,
    clientIdentityStatus:record?.productionSafety?.clientIdentity?.status||null,
    clientIdentityEnforcementSafe:record?.productionSafety?.clientIdentity?.enforcementSafe
  });
  check(readiness.readyForRcCandidate===true,'complete RC.1 evidence must reach RC candidate readiness');
  check(readiness.readyForGa===false,'RC.1 must not claim GA readiness');
  check(readiness.enforcementReadinessGranted===false,'RC.1 must not grant enforcement readiness');
  check(readiness.warnings.some(w=>w.code==='client_identity_degraded'),'known degraded HawkHost identity must remain an explicit warning');

  const blocked=buildAiAgentRcReadiness({
    rcStaticReady:true,priorBeta2GatePassed:true,validatedBaselineRecord:true,
    frozenContractHashMatches:true,requestPathUnchanged:false,privacyInvariantsPass:true,
    shadowSafetyPass:true,productionValidationSemanticsPass:true,releaseVerificationAvailable:true,
    documentationComplete:true,enforcementControlAvailable:false,changesRuntime:false
  });
  check(blocked.readyForRcCandidate===false && blocked.blockers.some(b=>b.code==='request_path_changed'),
    'critical request-path drift must block RC readiness');

  return {ok:failures.length===0,checks,failures,readiness,beta2Prerequisite:{checks:beta2.checks}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const r=await runAiAgentRcCheck();
  if(!r.ok) {
    for(const failure of r.failures) console.error('FAIL:',failure);
    process.exit(1);
  }
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} AI Agent RC Readiness PASS (${r.checks} invariants checked)`);
  for(const warning of r.readiness.warnings) console.log(`WARNING: ${warning.code}: ${warning.detail}`);
  if(ANCHORWEIGHT_RELEASE_CHANNEL==='stable')
    console.log('RC PREREQUISITE PRESERVED FOR v3.1 GA');
  else
    console.log('READY FOR v3.1 RC.1 BURN-IN');
}
