#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION,ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAgentPassport } from '../src/agent-passport.js';
import { buildAiAgentGaReadiness,describeAiAgentGaReadiness } from '../src/ai-agent-ga-readiness.js';
import { runAiAgentRcCheck } from './ai-agent-rc-check.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FROZEN_SHA256='85ff04b25499e458898f00c6b4b631764efce9b4ee74b11e1078723e29fa956a';
const RC1_COMMIT='b5ee49260c09ceb621718801aeae8001465adcb0';
const CRITICAL_BLOBS={
  "src/anchorweight.js":"24f3ed886fef80675e1935378e9efe4e1e6cebb3",
  "src/ai-agent-policy.js":"17078f8751c4eb086bd9ccfa1f3aecb04a166f05",
  "src/ai-agent-verification.js":"e4dd932caefb2819f8732f1575024193b5e1f1e7",
  "src/ai-agent-verification-policy.js":"57414ed19efb97796b2448f7f1679b22732ff495",
  "src/config.js":"d275ba238f0bae518b81d35edcafb09a017bd6f1",
  "src/config-schema.js":"a933cc5fe8a04999ad5b6605b9bb39264eab147a"
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

export async function runAiAgentGaCheck({root=ROOT}={}) {
  const failures=[];let checks=0;
  const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};

  check(ANCHORWEIGHT_VERSION==='3.1.0','runtime version must be 3.1.0');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='stable','release channel must be stable');

  const rc=await runAiAgentRcCheck({root});
  check(rc.ok===true,`RC.1 prerequisite failed: ${(rc.failures||[]).join('; ')}`);
  check((rc.failures||[]).length===0,'RC.1 prerequisite failures must remain empty');
  check(rc.readiness?.readyForRcCandidate===true,'RC.1 prerequisite readiness must remain green');
  check(rc.readiness?.enforcementReadinessGranted===false,'RC.1 prerequisite must not grant enforcement readiness');

  const frozen=path.join(root,'RC1-FROZEN-CONTRACT.json');
  const frozenMatches=fs.existsSync(frozen)&&sha256(frozen)===FROZEN_SHA256;
  check(frozenMatches,'frozen v3 contract hash changed');

  let record=null;
  try { record=readJson(path.join(root,'V3.1-GA-VALIDATION-RECORD.json')); }
  catch(err) { failures.push(`GA validation record unavailable: ${err.message}`); }
  const recordValid=!!record &&
    record.schema==='anchorweight-v31-ga-validation-record/v1' &&
    record.baselineVersion==='3.1.0-rc.1' &&
    record.baselineTag==='v3.1.0-rc.1' &&
    record.baselineCommit===RC1_COMMIT &&
    record.evidence?.localAggregate?.passed===486 &&
    record.evidence?.localAggregate?.expected===486 &&
    record.evidence?.rcReadinessInvariants?.passed===40 &&
    record.evidence?.rcReadinessInvariants?.expected===40 &&
    record.evidence?.releaseManifestSourceFiles===285 &&
    record.evidence?.releaseVerificationPassed===true &&
    record.evidence?.securityAuditHighVulnerabilities===0 &&
    record.evidence?.publicProductionShadowValidation===true &&
    record.evidence?.authenticatedOperatorValidation===true &&
    record.evidence?.liveAiCanaries?.passed===12 &&
    record.evidence?.liveAiCanaries?.expected===12 &&
    record.evidence?.restartComparisonPassed===true &&
    record.evidence?.subsequentProductionShadowValidationPassed===true &&
    record.evidence?.materialRegressionObserved===false &&
    record.productionSafety?.globalShadowMode===true &&
    record.productionSafety?.aiAgentPolicyEnforced===false &&
    record.secretsRecorded===false &&
    record.rawClientDataRecorded===false;
  check(recordValid,'validated RC.1 GA admission record is invalid');

  let requestPathUnchanged=true;
  for(const [rel,expected] of Object.entries(CRITICAL_BLOBS)) {
    const file=path.join(root,rel);
    const actual=fs.existsSync(file)?gitBlobSha(file):null;
    check(actual===expected,`validated request-path blob changed: ${rel}`);
    if(actual!==expected) requestPathUnchanged=false;
  }

  const passport=createAgentPassport({
    basePath:'/anchor',shadowMode:true,scoreEnforcementEnabled:false,
    policyEngineEnabled:true,policyEngineShadowMode:true,policyEngineEnforcementEnabled:false,
    aiAgentPolicyEnabled:true,aiAgentPolicyShadowMode:true,aiAgentPolicyEnforcementEnabled:false
  });
  const ai=passport.capabilities?.aiAgentControls;
  check(ai?.version===11,'Agent Passport must publish AI Agent Controls v11');
  check(ai?.gaReadiness?.available===true,'Agent Passport GA readiness descriptor missing');
  check(ai?.gaReadiness?.stableRelease===true,'Agent Passport must identify GA as stable release');
  check(ai?.gaReadiness?.enforcementReadinessGranted===false,'GA readiness must not grant enforcement readiness');
  check(ai?.gaReadiness?.enforcementControlAvailable===false,'GA readiness must expose no enforcement control');
  check(ai?.gaReadiness?.requiresPostDeployValidation===true,'GA must require post-deploy validation');
  check(ai?.rcReadiness?.available===true,'RC readiness provenance capability must remain available');
  check(ai?.productionValidation?.restartComparisonAvailable===true,'production restart comparison capability missing');
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
    productionSource.includes('ai?.gaReadiness?.available===true') &&
    productionSource.includes('val!==false && val!==null') &&
    productionSource.includes("headers:{'User-Agent':'GPTBot/1.4'}") &&
    productionSource.includes('robotsPolicyAccessible') &&
    productionSource.includes('AW_PRODUCTION_DASHBOARD_TOKEN') &&
    productionSource.includes('--capture') &&
    productionSource.includes('--compare');
  check(productionValidationSemanticsPass,'production validator GA safety semantics changed');

  const descriptor=describeAiAgentGaReadiness();
  check(descriptor.stableRelease===true && descriptor.changesRuntime===false,'GA descriptor must be stable/non-mutating');
  check(descriptor.enforcementReadinessGranted===false && descriptor.enforcementControlAvailable===false,'GA descriptor enforcement safety changed');
  check(descriptor.networkRequired===false && descriptor.requiresPostDeployValidation===true,'GA static gate/post-deploy semantics changed');

  const required=[
    'src/ai-agent-ga-readiness.js','scripts/ai-agent-ga-check.js',
    'test/unit/ai-agent-ga-readiness.test.js','test/unit/ai-agent-ga-integration.test.js',
    'AI-AGENT-GA-READINESS.md','V3.1.0-RELEASE-NOTES.md','V3.1-GA-VALIDATION-RECORD.json'
  ];
  let documentationComplete=true;
  for(const rel of required) {
    const exists=fs.existsSync(path.join(root,rel));
    check(exists,`missing GA artifact ${rel}`);
    if(!exists) documentationComplete=false;
  }

  const pkg=readJson(path.join(root,'package.json'));
  check(pkg.scripts?.['ai-agents:ga-check']==='node scripts/ai-agent-ga-check.js','package GA check script missing');
  const releaseSource=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  const releaseVerificationAvailable=
    releaseSource.includes('runAiAgentGaCheck') &&
    releaseSource.includes('AI Agent GA Readiness') &&
    releaseSource.includes('SOURCE-MANIFEST.json') &&
    releaseSource.includes("ANCHORWEIGHT_VERSION === '3.1.0'");
  check(releaseVerificationAvailable,'release-check GA wiring missing');

  const privacyInvariantsPass=
    ai?.gaReadiness?.rawIpExposed===false &&
    ai?.gaReadiness?.rawUserAgentExposed===false &&
    ai?.gaReadiness?.rawPathExposed===false &&
    ai?.gaReadiness?.rawQueryExposed===false &&
    ai?.gaReadiness?.credentialsExposed===false;
  check(privacyInvariantsPass,'GA readiness privacy descriptor changed');

  const readiness=buildAiAgentGaReadiness({
    gaStaticReady:true,
    priorRcGatePassed:rc.ok===true,
    validatedRc1Record:recordValid,
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
  check(readiness.readyForGaRelease===true,'complete GA evidence must reach GA release readiness');
  check(readiness.enforcementReadinessGranted===false,'GA must not grant enforcement readiness');
  check(readiness.postDeployValidationRequired===true,'GA must require post-deploy production validation');
  check(readiness.warnings.some(w=>w.code==='client_identity_degraded'),'known client-identity limitation must remain explicit');

  const blocked=buildAiAgentGaReadiness({
    gaStaticReady:true,priorRcGatePassed:true,validatedRc1Record:true,
    frozenContractHashMatches:true,requestPathUnchanged:false,privacyInvariantsPass:true,
    shadowSafetyPass:true,productionValidationSemanticsPass:true,releaseVerificationAvailable:true,
    documentationComplete:true,enforcementControlAvailable:false,changesRuntime:false
  });
  check(blocked.readyForGaRelease===false && blocked.blockers.some(b=>b.code==='request_path_changed'),
    'critical request-path drift must block GA release');

  return {ok:failures.length===0,checks,failures,readiness,rcPrerequisite:{checks:rc.checks}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const r=await runAiAgentGaCheck();
  if(!r.ok) {
    for(const failure of r.failures) console.error('FAIL:',failure);
    process.exit(1);
  }
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} AI Agent GA Readiness PASS (${r.checks} invariants checked)`);
  for(const warning of r.readiness.warnings) console.log(`WARNING: ${warning.code}: ${warning.detail}`);
  console.log('READY FOR v3.1.0 GA RELEASE');
  console.log('Active AI deny enforcement remains a separate explicit post-GA operator decision.');
}
