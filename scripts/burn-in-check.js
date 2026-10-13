#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAgentPassport } from '../src/agent-passport.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT=path.resolve(HERE,'..');
const EXPECTED_VERSION=ANCHORWEIGHT_VERSION;
const CONTRACT_FILE='RC1-FROZEN-CONTRACT.json';
const REQUIRED_FILES=['PRODUCTION-BURN-IN.md','RC2-RELEASE-NOTES.md','scripts/burn-in-check.js','test/unit/burn-in-check.test.js'];

function sameSet(left,right){return JSON.stringify([...(left||[])].sort())===JSON.stringify([...(right||[])].sort());}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function checkCollector(){const failures=[];const warnings=[];let checks=0;return {failures,warnings,check:(ok,msg)=>{checks++;if(!ok)failures.push(msg);},warn:(ok,msg)=>{if(!ok)warnings.push(msg);},count:()=>checks};}

export function runBurnInStaticCheck({root=DEFAULT_ROOT}={}){
  const c=checkCollector();
  let contract={},pkg={},lock={};
  try{contract=readJson(path.join(root,CONTRACT_FILE));}catch(err){c.failures.push(`frozen contract unavailable: ${err.message}`);}
  try{pkg=readJson(path.join(root,'package.json'));}catch(err){c.failures.push(`package.json unavailable: ${err.message}`);}
  try{lock=readJson(path.join(root,'package-lock.json'));}catch(err){c.failures.push(`package-lock unavailable: ${err.message}`);}

  c.check(ANCHORWEIGHT_VERSION===EXPECTED_VERSION,`runtime version must be ${EXPECTED_VERSION}`);
  c.check(['alpha','beta','rc','stable'].includes(ANCHORWEIGHT_RELEASE_CHANNEL),'release channel must be alpha, beta, rc, or stable');
  c.check(pkg.version===ANCHORWEIGHT_VERSION,'package version must match runtime version');
  c.check(lock.version===ANCHORWEIGHT_VERSION && lock.packages?.['']?.version===ANCHORWEIGHT_VERSION,'package-lock version must match runtime version');
  c.check(pkg.scripts?.['burnin:check']==='node scripts/burn-in-check.js','package must expose burnin:check');
  c.check(contract.schema==='anchorweight-rc-frozen-contract/v1','RC frozen contract schema changed');
  c.check(contract.release==='3.0.0-rc.1','RC.1 frozen contract must remain byte-preserved/owned by RC.1');
  c.check(contract.frozenFrom==='3.0.0-beta.7','frozen contract origin changed');

  const passport=createAgentPassport({basePath:'/anchor',shadowMode:true,scoreEnforcementEnabled:false,policyEngineEnabled:true,policyEngineEnforcementEnabled:false,policyEngineShadowMode:true});
  c.check(passport.schema===contract.agentPassportSchema,'Agent Passport schema changed during feature freeze');
  c.check(passport.version===ANCHORWEIGHT_VERSION,'Agent Passport version must use central version');
  c.check((contract.capabilities||[]).every(key=>Object.prototype.hasOwnProperty.call(passport.capabilities||{},key)),'a frozen v3.0 Agent Passport capability is missing');
  c.check(JSON.stringify(passport.capabilities?.policyEngine?.actions||[])===JSON.stringify(contract.policyActions||[]),'Policy Engine action ladder changed during feature freeze');
  for(const [key,expected] of Object.entries(contract.enforcementDefaults||{})) c.check(passport.enforcement?.[key]===expected,`frozen enforcement default changed: ${key}`);
  for(const key of contract.privacyFalseFlags||[]) c.check(passport.privacy?.[key]===false,`privacy invariant changed: ${key}`);
  c.check(passport.capabilities?.policySimulation?.mutatesState===false,'Policy Simulation must remain non-mutating');
  c.check(passport.capabilities?.policySimulation?.enforcement===false,'Policy Simulation must remain non-enforcing');
  c.check(passport.capabilities?.enforcementRehearsal?.mutatesState===false,'Enforcement Rehearsal must remain non-mutating');
  c.check(passport.capabilities?.enforcementRehearsal?.enforcement===false,'Enforcement Rehearsal must remain non-enforcing');
  c.check(passport.capabilities?.releaseReadiness?.mutatesState===false,'Release Readiness must remain non-mutating');
  c.check(passport.capabilities?.releaseReadiness?.enforcement===false,'Release Readiness must remain non-enforcing');
  c.check(passport.enforcement?.policyEngineEnforced===false,'RC.2 release fixture must remain non-enforcing');
  for(const file of REQUIRED_FILES)c.check(fs.existsSync(path.join(root,file)),`missing RC.2 burn-in artifact ${file}`);
  return {ok:c.failures.length===0,checks:c.count(),failures:c.failures,warnings:c.warnings};
}

export function evaluateBurnInSnapshot({live={},passport={},processes=null,contract={},expectedVersion=EXPECTED_VERSION}={}){
  const c=checkCollector();
  c.check(live?.ok===true,'/live must report ok:true');
  c.check(live?.version===expectedVersion,`/live version must be ${expectedVersion}`);
  c.check(live?.shadowMode===true,'production burn-in must remain in shadow mode');
  c.check(live?.proxyEnabled===true,'production burn-in expects reverse proxy enabled');
  c.check(passport?.schema===contract.agentPassportSchema,'Agent Passport schema drifted');
  c.check(passport?.version===expectedVersion,`Agent Passport version must be ${expectedVersion}`);
  c.check((contract.capabilities||[]).every(key=>Object.prototype.hasOwnProperty.call(passport?.capabilities||{},key)),'a frozen v3.0 Agent Passport capability is missing');
  c.check(JSON.stringify(passport?.capabilities?.policyEngine?.actions||[])===JSON.stringify(contract.policyActions||[]),'Policy Engine action ladder drifted');
  c.check(passport?.enforcement?.policyEngineEnforced===false,'Policy Engine must remain non-enforcing during burn-in');
  c.check(passport?.enforcement?.trafficDimensionsEnforced===false,'traffic dimensions must remain non-enforcing during burn-in');
  c.check(passport?.enforcement?.resourceBudgetsEnforced===false,'resource budgets must remain non-enforcing during burn-in');
  for(const key of contract.privacyFalseFlags||[])c.check(passport?.privacy?.[key]===false,`production privacy invariant changed: ${key}`);
  c.check(passport?.capabilities?.policySimulation?.mutatesState===false && passport?.capabilities?.policySimulation?.enforcement===false,'Policy Simulation must remain read-only/non-enforcing');
  c.check(passport?.capabilities?.enforcementRehearsal?.mutatesState===false && passport?.capabilities?.enforcementRehearsal?.enforcement===false,'Enforcement Rehearsal must remain read-only/non-enforcing');
  c.check(passport?.capabilities?.releaseReadiness?.mutatesState===false && passport?.capabilities?.releaseReadiness?.enforcement===false,'Release Readiness must remain read-only/non-enforcing');

  const identitySafe=live?.clientIdentity?.enforcementSafe===true;
  if(!identitySafe){
    c.warn(false,`client identity remains enforcement-blocked: ${String(live?.clientIdentity?.reason||'unknown_reason').slice(0,96)}`);
    c.check(live?.clientIdentity?.status==='degraded','unsafe client identity must report degraded status');
    c.check(typeof live?.clientIdentity?.reason==='string' && live.clientIdentity.reason.length>0,'unsafe client identity must include a bounded reason');
  }

  if(processes){
    c.check(Number(processes.standaloneAppProcesses||0)<=1,'multiple standalone AnchorWeight app.js processes detected');
    c.warn(Number(processes.standaloneAppProcesses||0)===0,'a standalone app.js process exists; cPanel/Passenger normally should own production workers');
    c.warn(Number(processes.lsnodeProcesses||0)>0,'no AnchorWeight lsnode workers observed during local process check');
    c.warn(Number(processes.totalAnchorWeightThreads||0)<=64,'AnchorWeight process/thread count exceeds 64; inspect shared-host resource pressure');
  }

  return {
    ok:c.failures.length===0,
    checks:c.count(),
    failures:c.failures,
    warnings:c.warnings,
    enforcementGate:identitySafe?'client_identity_safe_external_gate_still_required':'blocked_by_client_identity',
    observations:{
      version:live?.version||null,
      shadowMode:live?.shadowMode===true,
      proxyEnabled:live?.proxyEnabled===true,
      clientIdentityStatus:String(live?.clientIdentity?.status||'unknown').slice(0,32),
      clientIdentityReason:String(live?.clientIdentity?.reason||'').slice(0,96),
      enforcementSafe:identitySafe,
      standaloneAppProcesses:processes?Number(processes.standaloneAppProcesses||0):null,
      lsnodeProcesses:processes?Number(processes.lsnodeProcesses||0):null,
      totalAnchorWeightThreads:processes?Number(processes.totalAnchorWeightThreads||0):null
    },
    privacy:{rawRequestIdentityStored:false,rawHeadersStored:false,rawPathsStored:false,rawCookiesStored:false,credentialsStored:false}
  };
}

export function collectLocalProcessSnapshot({root=DEFAULT_ROOT}={}){
  if(process.platform==='win32')return {available:false,standaloneAppProcesses:0,lsnodeProcesses:0,totalAnchorWeightThreads:0};
  const user=process.env.USER||process.env.LOGNAME;
  if(!user)return {available:false,standaloneAppProcesses:0,lsnodeProcesses:0,totalAnchorWeightThreads:0};
  let output='';
  try{output=execFileSync('ps',['-u',user,'-o','pid=,ppid=,nlwp=,etime=,stat=,cmd='],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
  catch{return {available:false,standaloneAppProcesses:0,lsnodeProcesses:0,totalAnchorWeightThreads:0};}
  const appPath=path.join(path.resolve(root),'app.js');
  const lsPrefix=`lsnode:${path.resolve(root)}/`;
  let standalone=0,lsnode=0,threads=0;
  for(const raw of output.split(/\r?\n/)){
    const line=raw.trim();if(!line)continue;
    const match=line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);if(!match)continue;
    const nlwp=Number(match[3])||0;const cmd=match[6];
    const isApp=cmd.includes('node ') && cmd.endsWith(appPath);
    const isLs=cmd.startsWith(lsPrefix);
    if(isApp){standalone++;threads+=nlwp;}
    if(isLs){lsnode++;threads+=nlwp;}
  }
  return {available:true,standaloneAppProcesses:standalone,lsnodeProcesses:lsnode,totalAnchorWeightThreads:threads};
}

async function fetchJson(url){
  const res=await fetch(url,{redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw new Error(`${url} returned HTTP ${res.status}`);
  return res.json();
}
function parseArgs(argv){
  const ret={url:null,json:false,localProcesses:false};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--json')ret.json=true;
    else if(arg==='--local-processes')ret.localProcesses=true;
    else if(arg==='--url'){if(!argv[i+1])throw new Error('--url requires a value');ret.url=argv[++i];}
    else throw new Error(`unsupported burn-in argument: ${arg}`);
  }
  return ret;
}
function normalizeBaseUrl(value){
  const url=new URL(value);const local=['127.0.0.1','localhost','::1'].includes(url.hostname);
  if(url.protocol!=='https:' && !(local&&url.protocol==='http:'))throw new Error('burn-in URL must use HTTPS (HTTP allowed only for localhost)');
  url.pathname=url.pathname.replace(/\/$/,'');url.search='';url.hash='';return url.toString().replace(/\/$/,'');
}

const invoked=process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const args=parseArgs(process.argv.slice(2));
    const staticResult=runBurnInStaticCheck();
    if(!args.url){
      if(args.json)console.log(JSON.stringify(staticResult,null,2));
      else if(staticResult.ok)console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} burn-in static check PASS (${staticResult.checks} invariants checked)`);
      else for(const failure of staticResult.failures)console.error('FAIL:',failure);
      if(!staticResult.ok)process.exitCode=1;
    }else{
      if(!staticResult.ok)throw new Error(`static burn-in gate failed: ${staticResult.failures.join('; ')}`);
      const base=normalizeBaseUrl(args.url);
      const live=await fetchJson(`${base}/live`);
      const basePath=String(live?.basePath||'/anchor').replace(/\/$/,'')||'/anchor';
      const passport=await fetchJson(`${base}${basePath}/agent-passport`);
      const contract=readJson(path.join(DEFAULT_ROOT,CONTRACT_FILE));
      const processes=args.localProcesses?collectLocalProcessSnapshot():null;
      const result=evaluateBurnInSnapshot({live,passport,processes,contract});
      if(args.json)console.log(JSON.stringify(result,null,2));
      else{
        console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} live burn-in ${result.ok?'PASS':'FAIL'} (${result.checks} invariants checked)`);
        for(const warning of result.warnings)console.error('WARN:',warning);
        for(const failure of result.failures)console.error('FAIL:',failure);
        console.log(`enforcement gate: ${result.enforcementGate}`);
      }
      if(!result.ok)process.exitCode=1;
    }
  }catch(err){console.error('FAIL:',err.message);process.exitCode=1;}
}
