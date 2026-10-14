#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION } from '../src/version.js';
import { buildAiAgentProductionReadiness } from '../src/ai-agent-production-readiness.js';

const CANARIES=Object.freeze([
  ['GPTBot/1.4','openai:gptbot'],
  ['OAI-SearchBot/1.4','openai:oai-searchbot'],
  ['ChatGPT-User/1.0','openai:chatgpt-user'],
  ['OAI-AdsBot/1.0','openai:oai-adsbot'],
  ['ClaudeBot/1.0','anthropic:claudebot'],
  ['Claude-SearchBot/1.0','anthropic:claude-searchbot'],
  ['Claude-User/1.0','anthropic:claude-user'],
  ['PerplexityBot/1.0','perplexity:perplexitybot'],
  ['Perplexity-User/1.0','perplexity:perplexity-user'],
  ['Google-Agent','google:google-agent'],
  ['Google-GeminiNotebook','google:google-gemininotebook'],
  ['Google-CloudVertexBot','google:google-cloudvertexbot']
]);

function arg(name) {
  const i=process.argv.indexOf(name);
  return i>=0 ? process.argv[i+1] : null;
}
function flag(name) { return process.argv.includes(name); }
function normalizeBase(value) {
  const u=new URL(String(value||''));
  if(!['http:','https:'].includes(u.protocol)) throw new Error('production_check_url_must_be_http_or_https');
  u.hash='';u.search='';
  return u.href.replace(/\/$/,'');
}
async function get(url,{headers={},timeoutMs=5000}={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    return await fetch(url,{method:'GET',headers,redirect:'follow',cache:'no-store',signal:controller.signal});
  } finally { clearTimeout(timer); }
}
async function jsonGet(url,options={}) {
  const response=await get(url,options);
  let body=null;
  try { body=await response.json(); } catch {}
  return {response,body};
}
export function forbiddenAiData(value) {
  const forbidden=new Set(['rawip','ip','rawuseragent','useragent','rawpath','rawquery','query','cookie','cookies','credentials','authorization']);
  const stack=[value];
  while(stack.length) {
    const cur=stack.pop();
    if(!cur || typeof cur!=='object') continue;
    for(const [key,val] of Object.entries(cur)) {
      const normalized=String(key).toLowerCase();
      // Privacy descriptors explicitly declaring that a raw field is absent are
      // safe. Any populated/true sensitive field still fails closed.
      if(forbidden.has(normalized) && val!==false && val!==null) return key;
      if(val && typeof val==='object') stack.push(val);
    }
  }
  return null;
}
function safeState(stats,live) {
  return {
    schema:'anchorweight-ai-agent-production-state/v1',
    capturedAt:new Date().toISOString(),
    version:live?.version||null,
    basePath:live?.basePath||null,
    clientIdentity:{
      status:live?.clientIdentity?.status||null,
      enforcementSafe:live?.clientIdentity?.enforcementSafe===true,
      reason:live?.clientIdentity?.reason||null
    },
    policyManager:{
      savedDraftStatus:stats?.aiAgentPolicyManager?.savedDraftStatus||null
    },
    deployment:{
      prepared:stats?.aiAgentPolicyDeployment?.prepared===true,
      preparedPlanId:stats?.aiAgentPolicyDeployment?.preparedPlanId||null,
      rollbackAvailable:stats?.aiAgentPolicyDeployment?.rollbackAvailable===true
    },
    observability:{
      declaredRequests:Number(stats?.aiAgentTraffic?.declaredRequests??stats?.aiAgentTraffic?.requests??0)
    }
  };
}
function compareState(before,after) {
  const problems=[];
  if(before?.version!==after?.version) problems.push('version changed across restart comparison');
  if(before?.basePath!==after?.basePath) problems.push('basePath changed across restart comparison');
  if(before?.policyManager?.savedDraftStatus!==after?.policyManager?.savedDraftStatus)
    problems.push('saved draft status changed across restart comparison');
  if(before?.deployment?.prepared!==after?.deployment?.prepared)
    problems.push('prepared deployment state changed across restart comparison');
  if(before?.deployment?.rollbackAvailable!==after?.deployment?.rollbackAvailable)
    problems.push('rollback availability changed across restart comparison');
  if(before?.deployment?.preparedPlanId && after?.deployment?.preparedPlanId &&
     before.deployment.preparedPlanId!==after.deployment.preparedPlanId)
    problems.push('prepared deployment plan id changed across restart comparison');
  return {ok:problems.length===0,problems};
}

export async function runAiAgentProductionCheck(options={}) {
  const base=normalizeBase(options.baseUrl||process.env.AW_PRODUCTION_CHECK_URL);
  const token=options.token??process.env.AW_PRODUCTION_DASHBOARD_TOKEN??'';
  const timeoutMs=Math.max(1000,Math.min(15000,Number(options.timeoutMs||process.env.AW_PRODUCTION_CHECK_TIMEOUT_MS||5000)));
  const failures=[];
  const details={};

  const liveResult=await jsonGet(base+'/live',{timeoutMs});
  const live=liveResult.body;
  details.live={status:liveResult.response.status,version:live?.version||null,basePath:live?.basePath||null,shadowMode:live?.shadowMode,proxyEnabled:live?.proxyEnabled,
    clientIdentity:live?.clientIdentity?{status:live.clientIdentity.status,enforcementSafe:live.clientIdentity.enforcementSafe===true,reason:live.clientIdentity.reason||null}:null};
  const liveVersionMatches=liveResult.response.ok && live?.service==='AnchorWeight' && live?.version===ANCHORWEIGHT_VERSION;
  const liveShadowMode=live?.shadowMode===true;
  if(!liveVersionMatches) failures.push('live version/service mismatch');
  if(!liveShadowMode) failures.push('global shadow mode is not enabled');

  const passportResult=await jsonGet(base+'/.well-known/anchorweight',{timeoutMs});
  const passport=passportResult.body;
  const ai=passport?.capabilities?.aiAgentControls;
  const passportValid=passportResult.response.ok &&
    passport?.service==='AnchorWeight' &&
    passport?.version===ANCHORWEIGHT_VERSION &&
    ai?.version===9 &&
    ai?.productionValidation?.available===true &&
    passport?.enforcement?.aiAgentPolicyEnforced===false &&
    passport?.privacy?.rawIpExposed===false &&
    passport?.privacy?.rawUserAgentExposed===false &&
    passport?.privacy?.rawPathExposed===false &&
    passport?.privacy?.rawQueryExposed===false &&
    passport?.privacy?.credentialsExposed===false;
  if(!passportValid) failures.push('public Agent Passport validation failed');

  // AnchorWeight does not serve robots.txt itself. A site may legitimately have no
  // robots.txt and return 404. The production invariant is that the AI policy must
  // not turn crawler discovery into an AnchorWeight 403 or a server-side failure.
  const robots=await get(base+'/robots.txt',{timeoutMs,headers:{'User-Agent':'GPTBot/1.4'}});
  const robotsPolicyAccessible=robots.status!==403 && robots.status<500;
  details.robots={status:robots.status,policyAccessible:robotsPolicyAccessible};
  if(!robotsPolicyAccessible) failures.push(`/robots.txt AI-policy accessibility failed with HTTP ${robots.status}`);

  const browser=await get(base+'/',{timeoutMs,headers:{'User-Agent':'Mozilla/5.0 AnchorWeight-Production-Validator/1.0'}});
  const browserUnaffected=browser.status!==403 && browser.status<500;
  if(!browserUnaffected) failures.push(`browser canary returned HTTP ${browser.status}`);

  let canariesPassed=0;
  const canaryResults=[];
  for(const [ua,label] of CANARIES) {
    try {
      const response=await get(base+'/',{timeoutMs,headers:{'User-Agent':ua}});
      const ok=response.status!==403 && response.status<500;
      if(ok) canariesPassed++;
      canaryResults.push({label,status:response.status,pass:ok});
      if(!ok) failures.push(`${label} live canary returned HTTP ${response.status}`);
    } catch(err) {
      canaryResults.push({label,status:null,pass:false,error:err?.name==='AbortError'?'timeout':'request_failed'});
      failures.push(`${label} live canary request failed`);
    }
  }
  details.canaries=canaryResults;

  const basePath=typeof live?.basePath==='string'&&live.basePath.startsWith('/')?live.basePath.replace(/\/$/,''):'/anchor';
  let authenticatedChecksRequested=!!token;
  let authenticatedChecksPassed=false;
  let privacyChecksPassed=passportValid;
  let stats=null;

  if(token) {
    const headers={Authorization:`Bearer ${token}`};
    const endpoints=[
      ['stats',`${base}${basePath}/api/stats`],
      ['aiAgents',`${base}${basePath}/api/ai-agents`],
      ['policyManager',`${base}${basePath}/api/ai-agents/policy-manager`],
      ['policyDeployment',`${base}${basePath}/api/ai-agents/policy-deployment`]
    ];
    const authResults={};
    let authOk=true;
    for(const [name,url] of endpoints) {
      const result=await jsonGet(url,{timeoutMs,headers});
      authResults[name]={status:result.response.status};
      if(!result.response.ok || !result.body) {authOk=false;failures.push(`${name} authenticated API returned HTTP ${result.response.status}`);continue;}
      const forbidden=forbiddenAiData(name==='stats'?{
        aiAgentTraffic:result.body.aiAgentTraffic,
        aiAgentPolicyManager:result.body.aiAgentPolicyManager,
        aiAgentPolicyDeployment:result.body.aiAgentPolicyDeployment
      }:result.body);
      if(forbidden) {privacyChecksPassed=false;authOk=false;failures.push(`${name} AI API exposed forbidden key ${forbidden}`);}
      if(name==='stats') stats=result.body;
    }
    details.authenticatedApis=authResults;
    if(stats) {
      if(stats.aiAgentPolicyManager?.enforcementControlAvailable!==false) {authOk=false;failures.push('policy manager enforcement control contract changed');}
      if(stats.aiAgentPolicyDeployment?.enforcementControlAvailable!==false) {authOk=false;failures.push('policy deployment enforcement control contract changed');}
      if(stats.aiAgentPolicyDeployment?.automaticActivation!==false) {authOk=false;failures.push('policy deployment automatic activation contract changed');}
    }
    authenticatedChecksPassed=authOk;
  }

  let restartComparisonRequested=false,restartComparisonPassed=false,restartComparison=null;
  const captureFile=options.captureFile||null;
  const compareFile=options.compareFile||null;
  if(captureFile) {
    if(!stats) throw new Error('capture_requires_AW_PRODUCTION_DASHBOARD_TOKEN');
    const state=safeState(stats,live);
    const file=path.resolve(captureFile);
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});
    fs.chmodSync(file,0o600);
    details.capturedState=file;
  }
  if(compareFile) {
    if(!stats) throw new Error('compare_requires_AW_PRODUCTION_DASHBOARD_TOKEN');
    restartComparisonRequested=true;
    const before=JSON.parse(fs.readFileSync(path.resolve(compareFile),'utf8'));
    const after=safeState(stats,live);
    restartComparison=compareState(before,after);
    restartComparisonPassed=restartComparison.ok;
    details.restartComparison=restartComparison;
    if(!restartComparison.ok) failures.push(...restartComparison.problems);
  }

  const readiness=buildAiAgentProductionReadiness({
    beta2StaticReady:true,
    liveVersionMatches,
    liveShadowMode,
    aiEnforcementDisabled:passport?.enforcement?.aiAgentPolicyEnforced===false,
    passportValid,
    robotsPolicyAccessible,
    browserUnaffected,
    canariesExpected:CANARIES.length,
    canariesPassed,
    authenticatedChecksRequested,
    authenticatedChecksPassed,
    privacyChecksPassed,
    clientIdentityStatus:live?.clientIdentity?.status||null,
    clientIdentityEnforcementSafe:live?.clientIdentity?.enforcementSafe===true,
    restartComparisonRequested,
    restartComparisonPassed
  });

  return {ok:failures.length===0 && readiness.productionShadowValidated,failures,readiness,details};
}

const isMain=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain) {
  try {
    const baseUrl=arg('--url')||process.env.AW_PRODUCTION_CHECK_URL;
    if(!baseUrl) throw new Error('Set AW_PRODUCTION_CHECK_URL or pass --url https://example.com');
    if(arg('--token')) throw new Error('Do not pass dashboard tokens on the command line; use AW_PRODUCTION_DASHBOARD_TOKEN');
    const result=await runAiAgentProductionCheck({
      baseUrl,
      timeoutMs:arg('--timeout-ms'),
      captureFile:arg('--capture'),
      compareFile:arg('--compare')
    });
    if(flag('--json')) console.log(JSON.stringify(result,null,2));
    else {
      if(!result.ok) {
        for(const failure of result.failures) console.error('FAIL:',failure);
        console.error(`AnchorWeight ${ANCHORWEIGHT_VERSION} Production Shadow Validation FAILED`);
      } else {
        console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} Production Shadow Validation PASS`);
        console.log(`Live AI canaries: ${result.readiness.canaries.passed}/${result.readiness.canaries.expected}`);
        for(const warning of result.readiness.warnings) console.log(`WARNING: ${warning.code}: ${warning.detail}`);
        if(result.readiness.readyForRcReview) console.log('READY FOR v3.1 RC REVIEW');
        else console.log('Production shadow validation passed; authenticated/restart evidence may still be collected before RC review.');
      }
    }
    if(!result.ok) process.exit(1);
  } catch(err) {
    console.error('FAIL:',err?.message||String(err));
    process.exit(1);
  }
}
