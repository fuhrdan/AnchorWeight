#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION,ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAgentPassport } from '../src/agent-passport.js';
import { describeAiAgentProductionReadiness,buildAiAgentProductionReadiness } from '../src/ai-agent-production-readiness.js';
import { runAiAgentBetaCheck } from './ai-agent-beta-check.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function runAiAgentBeta2Check({root=ROOT}={}) {
  const failures=[];let checks=0;const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};

  check(ANCHORWEIGHT_VERSION==='3.1.0-beta.2','runtime version must be 3.1.0-beta.2');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='beta','release channel must remain beta');

  const beta=await runAiAgentBetaCheck({root});
  check(beta.ok===true,`beta.1 stabilization prerequisite failed: ${(beta.failures||[]).join('; ')}`);
  check(beta.readiness?.readyForBetaValidation===true,'beta.1 readiness must remain ready for beta validation');
  check((beta.readiness?.blockers||[]).length===0,'beta.1 readiness blockers must remain empty');
  check(beta.readiness?.enforcementReadinessGranted===false,'beta.1 must still grant no enforcement readiness');

  const descriptor=describeAiAgentProductionReadiness();
  check(descriptor.liveShadowValidation===true && descriptor.publicCanaries===true,'production validation descriptor missing live canaries');
  check(descriptor.authenticatedOperatorChecks===true,'production validation descriptor missing authenticated operator checks');
  check(descriptor.restartComparisonAvailable===true && descriptor.restartComparisonRequiredForRcReview===true && descriptor.automaticRestart===false,'restart validation must remain manual and required for RC review');
  check(descriptor.automaticActivation===false && descriptor.enforcementControlAvailable===false,'production validation must expose no activation/enforcement control');
  check(descriptor.dashboardTokenFromEnvironmentOnly===true,'dashboard token must be environment-only');
  check(descriptor.changesRuntime===false && descriptor.writesHostingConfiguration===false,'production validator must not mutate runtime/hosting configuration');
  check(descriptor.rawIpExposed===false && descriptor.rawUserAgentExposed===false && descriptor.rawPathExposed===false && descriptor.rawQueryExposed===false,'production validation privacy descriptor changed');

  const sample=buildAiAgentProductionReadiness({
    beta2StaticReady:true,liveVersionMatches:true,liveShadowMode:true,aiEnforcementDisabled:true,passportValid:true,
    robotsReachable:true,browserUnaffected:true,canariesExpected:12,canariesPassed:12,
    authenticatedChecksRequested:true,authenticatedChecksPassed:true,privacyChecksPassed:true,
    clientIdentityStatus:'degraded',clientIdentityEnforcementSafe:false,
    restartComparisonRequested:true,restartComparisonPassed:true
  });
  check(sample.productionShadowValidated===true,'valid production evidence must pass shadow validation');
  check(sample.readyForRcReview===true,'complete production evidence must reach RC review');
  check(sample.enforcementReadinessGranted===false,'RC-review evidence must not grant enforcement readiness');
  check(sample.warnings.some(w=>w.code==='client_identity_degraded'),'degraded HawkHost identity must be a warning, not a false pass/fail');

  const active=buildAiAgentProductionReadiness({
    beta2StaticReady:true,liveVersionMatches:true,liveShadowMode:true,aiEnforcementDisabled:false,passportValid:true,
    robotsReachable:true,browserUnaffected:true,canariesExpected:12,canariesPassed:12,privacyChecksPassed:true
  });
  check(active.productionShadowValidated===false && active.blockers.some(b=>b.code==='ai_enforcement_enabled'),'active AI enforcement must block beta.2 shadow validation');

  const passport=createAgentPassport({});
  check(passport.capabilities?.aiAgentControls?.version===9,'Agent Passport must publish AI Agent Controls v9');
  check(passport.capabilities?.aiAgentControls?.productionValidation?.available===true,'Agent Passport production validation capability missing');
  check(passport.capabilities?.aiAgentControls?.productionValidation?.enforcementControlAvailable===false,'passport production validation must expose no enforcement control');
  check(passport.capabilities?.aiAgentControls?.productionValidation?.dashboardTokenFromEnvironmentOnly===true,'passport must state dashboard token environment-only');

  const productionSource=fs.readFileSync(path.join(root,'scripts/ai-agent-production-check.js'),'utf8');
  check(productionSource.includes('AW_PRODUCTION_CHECK_URL'),'production validator URL environment support missing');
  check(productionSource.includes('AW_PRODUCTION_DASHBOARD_TOKEN'),'production validator dashboard token environment support missing');
  check(productionSource.includes("throw new Error('Do not pass dashboard tokens on the command line"),'production validator must reject CLI token');
  check(productionSource.includes("['GPTBot/1.4'") && productionSource.includes("['Google-CloudVertexBot'"),'12-family live canary matrix missing');
  check(productionSource.includes("base+'/robots.txt'"),'robots.txt live validation missing');
  check(productionSource.includes("base+'/.well-known/anchorweight'"),'Agent Passport live validation missing');
  check(productionSource.includes('/api/ai-agents/policy-manager') && productionSource.includes('/api/ai-agents/policy-deployment'),'authenticated operator API validation missing');
  check(productionSource.includes('--capture') && productionSource.includes('--compare'),'restart persistence capture/compare workflow missing');

  for(const file of [
    'src/ai-agent-production-readiness.js','scripts/ai-agent-production-check.js','scripts/ai-agent-beta2-check.js',
    'test/unit/ai-agent-production-readiness.test.js','test/unit/ai-agent-production-integration.test.js',
    'AI-AGENT-PRODUCTION-SHADOW-VALIDATION.md','V3.1.0-BETA2-RELEASE-NOTES.md'
  ]) check(fs.existsSync(path.join(root,file)),`missing beta.2 artifact ${file}`);

  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  check(pkg.scripts?.['ai-agents:production-check']==='node scripts/ai-agent-production-check.js','package production check script missing');
  check(pkg.scripts?.['ai-agents:beta2-check']==='node scripts/ai-agent-beta2-check.js','package beta2 check script missing');

  const release=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  check(release.includes('runAiAgentBeta2Check') && release.includes('AI Agent Beta.2 Stabilization'),'release check beta.2 gate wiring missing');

  return {ok:failures.length===0,checks,failures,betaPrerequisite:{checks:beta.checks}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const r=await runAiAgentBeta2Check();
  if(!r.ok){for(const f of r.failures)console.error('FAIL:',f);process.exit(1);}
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} Beta.2 Production Validation Harness PASS (${r.checks} invariants checked)`);
  console.log('READY FOR PRODUCTION SHADOW VALIDATION');
}
