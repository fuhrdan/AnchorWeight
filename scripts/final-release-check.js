#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { runRcHardeningCheck } from './rc-hardening-check.js';
import { runBurnInStaticCheck } from './burn-in-check.js';
import { createAgentPassport } from '../src/agent-passport.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..');
const FINAL_VERSION='3.0.0';
const FINAL_CHANNEL='stable';

export function runFinalReleaseCheck({root=DEFAULT_ROOT}={}) {
  const failures=[];
  let checks=0;
  const check=(condition,message)=>{checks++;if(!condition)failures.push(message);};
  let pkg={},lock={},contract={};
  try{pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));}catch(err){failures.push(`package.json unavailable: ${err.message}`);}
  try{lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));}catch(err){failures.push(`package-lock unavailable: ${err.message}`);}
  try{contract=JSON.parse(fs.readFileSync(path.join(root,'RC1-FROZEN-CONTRACT.json'),'utf8'));}catch(err){failures.push(`frozen contract unavailable: ${err.message}`);}

  check(ANCHORWEIGHT_VERSION===FINAL_VERSION,'runtime version must be 3.0.0');
  check(ANCHORWEIGHT_RELEASE_CHANNEL===FINAL_CHANNEL,'release channel must be stable');
  check(!ANCHORWEIGHT_VERSION.includes('-'),'final version must not contain a prerelease suffix');
  check(pkg.version===FINAL_VERSION,'package version must be 3.0.0');
  check(lock.version===FINAL_VERSION && lock.packages?.['']?.version===FINAL_VERSION,'package-lock version must be 3.0.0');
  check(pkg.scripts?.['final:check']==='node scripts/final-release-check.js','package must expose final:check');
  check(pkg.scripts?.['burnin:check']==='node scripts/burn-in-check.js','package must retain burnin:check');
  check(pkg.scripts?.['security:check']==='npm audit --audit-level=high','package must retain high-severity security audit gate');
  check(contract.schema==='anchorweight-rc-frozen-contract/v1','frozen contract schema changed');
  check(contract.release==='3.0.0-rc.1','frozen contract release marker changed');
  check(contract.frozenFrom==='3.0.0-beta.7','frozen contract origin changed');

  for(const file of ['PRODUCTION-BURN-IN.md','RC2-RELEASE-NOTES.md','FINAL-RELEASE-CHECKLIST.md','V3.0.0-RELEASE-NOTES.md'])
    check(fs.existsSync(path.join(root,file)),`missing final release artifact ${file}`);

  const hardening=runRcHardeningCheck({root});
  check(hardening.ok,`feature-freeze hardening failed: ${hardening.failures.join('; ')}`);
  const burnin=runBurnInStaticCheck({root});
  check(burnin.ok,`burn-in static gate failed: ${burnin.failures.join('; ')}`);

  const passport=createAgentPassport({
    basePath:'/anchor',shadowMode:true,scoreEnforcementEnabled:false,
    policyEngineEnabled:true,policyEngineEnforcementEnabled:false,policyEngineShadowMode:true
  });
  check(passport.version===FINAL_VERSION,'Agent Passport must expose final version');
  check(JSON.stringify(Object.keys(passport.capabilities||{}).sort())===JSON.stringify([...(contract.capabilities||[])].sort()),'final Agent Passport capability surface changed after freeze');
  check(passport.enforcement?.policyEngineEnforced===false,'final default Policy Engine posture must remain non-enforcing');
  check(passport.capabilities?.policySimulation?.mutatesState===false && passport.capabilities?.policySimulation?.enforcement===false,'Policy Simulation must remain read-only/non-enforcing');
  check(passport.capabilities?.enforcementRehearsal?.mutatesState===false && passport.capabilities?.enforcementRehearsal?.enforcement===false,'Enforcement Rehearsal must remain read-only/non-enforcing');
  check(passport.capabilities?.releaseReadiness?.requiresTrustedClientIdentity===true,'final release readiness must retain trusted-client-identity requirement');
  check(passport.capabilities?.releaseReadiness?.requiresExternalReleaseGate===true,'final release readiness must retain external release gate');
  for(const key of contract.privacyFalseFlags||[]) check(passport.privacy?.[key]===false,`final privacy invariant changed: ${key}`);

  return {ok:failures.length===0,checks,failures,hardeningChecks:hardening.checks,burnInChecks:burnin.checks};
}

const invoked=process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const result=runFinalReleaseCheck();
  if(!result.ok){for(const failure of result.failures)console.error('FAIL:',failure);process.exit(1);}
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} final release PASS (${result.checks} final invariants; ${result.hardeningChecks} feature-freeze; ${result.burnInChecks} burn-in)`);
}
