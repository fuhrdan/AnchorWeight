#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAgentPassport } from '../src/agent-passport.js';
import { evaluatePolicyDecision } from '../src/policy-engine.js';
import { buildReleaseReadiness, releaseReadinessDescriptor } from '../src/release-readiness.js';
import { enforcementRehearsalDescriptor } from '../src/enforcement-rehearsal.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..');

function sameSet(left,right) {
  return JSON.stringify([...left].sort())===JSON.stringify([...right].sort());
}

export function runRcHardeningCheck({root=DEFAULT_ROOT}={}) {
  const failures=[];
  let checks=0;
  const check=(condition,message)=>{checks++;if(!condition)failures.push(message);};
  let contract={},pkg={},lock={};
  try { contract=JSON.parse(fs.readFileSync(path.join(root,'RC1-FROZEN-CONTRACT.json'),'utf8')); }
  catch(err) { failures.push(`frozen contract unavailable: ${err.message}`); }
  try { pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')); }
  catch(err) { failures.push(`package.json unavailable: ${err.message}`); }
  try { lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8')); }
  catch(err) { failures.push(`package-lock.json unavailable: ${err.message}`); }

  check(ANCHORWEIGHT_VERSION==='3.0.0','runtime version must be 3.0.0');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='stable','release channel must be stable');
  check(pkg.version===ANCHORWEIGHT_VERSION,'package version must match central runtime version');
  check(lock.version===ANCHORWEIGHT_VERSION && lock.packages?.['']?.version===ANCHORWEIGHT_VERSION,'package-lock versions must match central runtime version');
  check(pkg.scripts?.['rc:check']==='node scripts/rc-hardening-check.js','package must expose rc:check');
  check(contract.schema==='anchorweight-rc-frozen-contract/v1','frozen contract schema must be v1');
  check(contract.frozenFrom==='3.0.0-beta.7','RC.1 contract must be frozen from beta.7');

  const config={basePath:'/anchor',shadowMode:true,scoreEnforcementEnabled:false,policyEngineEnabled:true,policyEngineEnforcementEnabled:false,policyEngineShadowMode:true};
  const passport=createAgentPassport(config);
  check(passport.schema===contract.agentPassportSchema,'Agent Passport schema changed after feature freeze');
  check(passport.version===ANCHORWEIGHT_VERSION,'Agent Passport version must use central version');
  check(sameSet(Object.keys(passport.capabilities||{}),contract.capabilities||[]),'Agent Passport capability surface changed after feature freeze');
  check(JSON.stringify(passport.capabilities?.policyEngine?.actions||[])===JSON.stringify(contract.policyActions||[]),'Policy Engine action ladder changed after feature freeze');
  for(const [key,expected] of Object.entries(contract.enforcementDefaults||{})) check(passport.enforcement?.[key]===expected,`frozen enforcement default changed: ${key}`);
  for(const key of contract.privacyFalseFlags||[]) check(passport.privacy?.[key]===false,`privacy invariant changed: ${key}`);

  const simulation=passport.capabilities?.policySimulation||{};
  check(simulation.mutatesState===false,'Policy Simulation must remain non-mutating');
  check(simulation.enforcement===false,'Policy Simulation must remain non-enforcing');
  const rehearsal=enforcementRehearsalDescriptor();
  check(rehearsal.mutatesState===false,'Enforcement Rehearsal must remain non-mutating');
  check(rehearsal.enforcement===false,'Enforcement Rehearsal must remain non-enforcing');
  check(rehearsal.requiresTrustedClientIdentityForTrial===true,'Enforcement Rehearsal must retain trusted-client-identity trial gate');
  const readinessDescriptor=releaseReadinessDescriptor();
  check(readinessDescriptor.mutatesState===false,'Release Readiness must remain non-mutating');
  check(readinessDescriptor.enforcement===false,'Release Readiness must remain non-enforcing');
  check(readinessDescriptor.requiresTrustedClientIdentity===true,'Release Readiness must require trusted client identity');
  check(readinessDescriptor.requiresExternalReleaseGate===true,'Release Readiness must require the external release gate');

  const decision=evaluatePolicyDecision(
    {manualPolicy:null,goodBotVerified:false,blackholeVisits:1,invalidTraversals:2,proofOfCrawl:1,agentIdentity:{current:{trafficClass:'unknown_automation'}}},
    {automationConfidence:{score:95},policyRisk:{score:95},resourcePressure:{score:90}},
    {status:'exceeded'},config,{now:1234}
  );
  check(decision.wouldEnforce===true,'high-risk RC fixture must produce a would-enforce recommendation');
  check(decision.enforcementEligible===false,'shadow-first RC fixture must never be enforcement-eligible');
  check(decision.enforcement==='shadow_only','shadow-first RC fixture must remain shadow-only');

  const readiness=buildReleaseReadiness({
    config,
    clientIdentity:{status:'degraded',reason:'trusted_proxy_client_ip_unavailable',enforcementSafe:false,diagnostics:{operatorAction:'hosting fix required'}},
    publicProfiles:[],agentObservatory:{policyCalibration:{evaluations:0,highImpactRecommendations:0}},totalProfiles:0
  });
  check(readiness.verdict==='blocked','degraded client identity must block release readiness');
  check(readiness.enforcementReady===false,'degraded client identity must not be enforcement-ready');
  check(readiness.checks?.find(x=>x.id==='client_identity')?.status==='fail','client identity readiness check must fail while identity is degraded');

  for(const file of ['RELEASE-CANDIDATE-HARDENING.md','RC1-RELEASE-NOTES.md','RC1-FROZEN-CONTRACT.json'])
    check(fs.existsSync(path.join(root,file)),`missing RC.1 artifact ${file}`);

  return {ok:failures.length===0,checks,failures};
}

const invoked=process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked) {
  const result=runRcHardeningCheck();
  if(!result.ok) {
    for(const failure of result.failures) console.error('FAIL:',failure);
    process.exit(1);
  }
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} feature-freeze hardening PASS (${result.checks} invariants checked)`);
}
