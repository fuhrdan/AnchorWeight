import fs from 'node:fs';
import path from 'node:path';
import { resolveAiAgentAction } from './ai-agent-policy.js';
import { applyAiAgentVerificationPolicy, parseAiAgentVerificationRules } from './ai-agent-verification-policy.js';

export const AI_AGENT_POLICY_DRAFT_SCHEMA='anchorweight-ai-agent-policy-draft/v1';
const ACTIONS=Object.freeze(['allow','observe','deny']);
const PURPOSE_FIELDS=Object.freeze({
  modelTraining:'aiAgentTrainingAction',
  searchIndexing:'aiAgentSearchAction',
  userRetrieval:'aiAgentUserAction',
  generalAutomation:'aiAgentAutomationAction'
});
const FAMILY_RE=/^([a-z0-9_-]{2,32}):([a-z0-9_-]{2,64})=(allow|observe|deny)$/;
const VERIFICATION_RE=/^([a-z0-9_-]{2,32}):([a-z0-9_-]{2,64})@(verified|unverified|unavailable|disabled)=(allow|observe|deny)$/;
const MAX_RULES=32;
const MAX_DRAFT_BYTES=32768;
const DEFAULT_DRAFT_FILE='./data/ai-agent-policy-draft.json';

function action(value,fallback='observe') {
  const v=String(value||'').trim().toLowerCase();
  return ACTIONS.includes(v)?v:fallback;
}

function list(value) {
  if(Array.isArray(value)) return value.map(v=>String(v||'').trim().toLowerCase()).filter(Boolean);
  return String(value||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
}

function canonicalRules(values,re,kind,errors,warnings) {
  const input=list(values);
  if(input.length>MAX_RULES) errors.push(`${kind}Rules must contain no more than ${MAX_RULES} entries`);
  const seen=new Map();
  const out=[];
  for(const raw of input.slice(0,MAX_RULES)) {
    const match=raw.match(re);
    if(!match){errors.push(`invalid ${kind} rule: ${raw.slice(0,160)}`);continue;}
    const key=kind==='family'?`${match[1]}:${match[2]}`:`${match[1]}:${match[2]}@${match[3]}`;
    const prior=seen.get(key);
    const next=match.at(-1);
    if(prior){
      if(prior!==next) errors.push(`conflicting ${kind} rule for ${key}`);
      else warnings.push(`duplicate ${kind} rule for ${key} was collapsed`);
      continue;
    }
    seen.set(key,next);
    out.push(raw);
  }
  out.sort();
  return out;
}

export function currentAiAgentPolicyDraft(config={}) {
  return {
    schema:AI_AGENT_POLICY_DRAFT_SCHEMA,
    purposeActions:{
      modelTraining:action(config.aiAgentTrainingAction),
      searchIndexing:action(config.aiAgentSearchAction),
      userRetrieval:action(config.aiAgentUserAction),
      generalAutomation:action(config.aiAgentAutomationAction)
    },
    familyRules:list(config.aiAgentFamilyRules).sort(),
    verificationRules:list(config.aiAgentVerificationRules).sort()
  };
}

export function validateAiAgentPolicyDraft(input={}) {
  const errors=[];const warnings=[];
  if(!input || typeof input!=='object' || Array.isArray(input)) return {valid:false,errors:['draft must be an object'],warnings,canonical:null};
  for(const key of Object.keys(input)) if(!['schema','purposeActions','familyRules','verificationRules'].includes(key)) errors.push(`unknown draft field: ${key}`);
  if(input.schema!=null && input.schema!==AI_AGENT_POLICY_DRAFT_SCHEMA) errors.push('unsupported draft schema');
  const pa=input.purposeActions;
  if(!pa || typeof pa!=='object' || Array.isArray(pa)) errors.push('purposeActions must be an object');
  const purposeActions={};
  for(const key of Object.keys(PURPOSE_FIELDS)) {
    const value=pa?.[key];
    if(!ACTIONS.includes(String(value||'').toLowerCase())) errors.push(`${key} must be allow, observe, or deny`);
    purposeActions[key]=action(value);
  }
  if(pa && typeof pa==='object' && !Array.isArray(pa)) for(const key of Object.keys(pa)) if(!(key in PURPOSE_FIELDS)) errors.push(`unknown purpose action: ${key}`);
  const familyRules=canonicalRules(input.familyRules??[],FAMILY_RE,'family',errors,warnings);
  const verificationRules=canonicalRules(input.verificationRules??[],VERIFICATION_RE,'verification',errors,warnings);
  const familyMap=new Map(familyRules.map(r=>{const m=r.match(FAMILY_RE);return [`${m[1]}:${m[2]}`,m[3]];}));
  for(const rule of verificationRules){
    const m=rule.match(VERIFICATION_RE);const familyKey=`${m[1]}:${m[2]}`;const base=familyMap.get(familyKey);
    if(base && base!==m[4]) warnings.push(`${rule} overrides family rule ${familyKey}=${base} when verification status matches`);
    if(m[3]==='unavailable' && m[4]==='allow') warnings.push(`${rule} allows a declaration when provider verification is unavailable; allow still grants no trust`);
  }
  const parsedVerification=parseAiAgentVerificationRules(verificationRules);
  if(parsedVerification.invalid.length) errors.push('verification rules failed runtime parser validation');
  const canonical={schema:AI_AGENT_POLICY_DRAFT_SCHEMA,purposeActions,familyRules,verificationRules};
  return {valid:errors.length===0,errors,warnings,canonical:errors.length?null:canonical};
}

function configFromDraft(draft) {
  return {
    aiAgentPolicyEnabled:true,
    aiAgentPolicyShadowMode:true,
    aiAgentPolicyEnforcementEnabled:false,
    aiAgentTrainingAction:draft.purposeActions.modelTraining,
    aiAgentSearchAction:draft.purposeActions.searchIndexing,
    aiAgentUserAction:draft.purposeActions.userRetrieval,
    aiAgentAutomationAction:draft.purposeActions.generalAutomation,
    aiAgentFamilyRules:[...draft.familyRules],
    aiAgentVerificationRules:[...draft.verificationRules]
  };
}

function baseDecisionFor(entry,config) {
  const identity={provider:entry.provider,family:entry.family,purpose:entry.purpose};
  const resolved=resolveAiAgentAction(identity,config);
  const deny=resolved.action==='deny';
  return {
    version:1,enabled:true,matched:true,action:resolved.action,
    enforcement:deny?'shadow_only':resolved.action==='allow'?'allow_without_trust':'observe',
    enforcementEligible:false,trustGranted:false,provider:entry.provider,family:entry.family,purpose:entry.purpose,
    reason:deny?'ai_agent_shadow_mode':resolved.source,invalidRuleCount:resolved.invalidRules.length
  };
}

export function previewAiAgentPolicyDraft(draft,trafficSnapshot={}) {
  const checked=validateAiAgentPolicyDraft(draft);
  if(!checked.valid) return {valid:false,errors:checked.errors,warnings:checked.warnings,preview:null,environment:null,canonical:null};
  const canonical=checked.canonical;
  const config=configFromDraft(canonical);
  const sample=Array.isArray(trafficSnapshot?.recent)?trafficSnapshot.recent.slice(-24):[];
  const actions={allow:0,observe:0,deny:0};
  const outcomes={allowed:0,observed:0,would_deny:0};
  const changes=[];
  for(const entry of sample){
    const base=baseDecisionFor(entry,config);
    const verification={status:entry.verificationStatus,provider:entry.provider,family:entry.family,verified:entry.verificationStatus==='verified',trustGranted:false};
    const decision=applyAiAgentVerificationPolicy(base,verification,config);
    actions[decision.action]=(actions[decision.action]||0)+1;
    const outcome=decision.action==='deny'?'would_deny':decision.action==='allow'?'allowed':'observed';
    outcomes[outcome]=(outcomes[outcome]||0)+1;
    if(decision.action!==entry.action || decision.policySource!==entry.policySource) changes.push({
      provider:entry.provider,family:entry.family,purpose:entry.purpose,verificationStatus:entry.verificationStatus,
      currentAction:entry.action,currentPolicySource:entry.policySource,
      candidateAction:decision.action,candidatePolicySource:decision.policySource
    });
  }
  return {
    valid:true,errors:[],warnings:checked.warnings,canonical,
    preview:{sampleSize:sample.length,changedDecisions:changes.length,actions,outcomes,changes:changes.slice(0,24),enforcement:false,shadowOnly:true},
    environment:exportAiAgentPolicyEnvironment(canonical)
  };
}

function shellValue(value) {
  const text=String(value??'');
  return /^[A-Za-z0-9_.,:@=\/-]*$/.test(text)?text:`'${text.replaceAll("'","'\\''")}'`;
}

export function exportAiAgentPolicyEnvironment(draft) {
  const checked=validateAiAgentPolicyDraft(draft);
  if(!checked.valid) return null;
  const d=checked.canonical;
  const lines=[
    ['AW_AI_AGENT_POLICY_ENABLED','true'],
    ['AW_AI_AGENT_POLICY_SHADOW_MODE','true'],
    ['AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED','false'],
    ['AW_AI_AGENT_TRAINING_ACTION',d.purposeActions.modelTraining],
    ['AW_AI_AGENT_SEARCH_ACTION',d.purposeActions.searchIndexing],
    ['AW_AI_AGENT_USER_ACTION',d.purposeActions.userRetrieval],
    ['AW_AI_AGENT_AUTOMATION_ACTION',d.purposeActions.generalAutomation],
    ['AW_AI_AGENT_VERIFICATION_ENABLED','true'],
    ['AW_AI_AGENT_FAMILY_RULES',d.familyRules.join(',')],
    ['AW_AI_AGENT_VERIFICATION_RULES',d.verificationRules.join(',')]
  ];
  return lines.map(([k,v])=>`${k}=${shellValue(v)}`).join('\n')+'\n';
}

function safeDraftFile(file) {
  const resolved=path.resolve(String(file||DEFAULT_DRAFT_FILE));
  return resolved;
}

export class AiAgentPolicyManager {
  constructor(config={},trafficObservatory=null,{draftFile=DEFAULT_DRAFT_FILE}={}) {
    this.config=config;this.trafficObservatory=trafficObservatory;this.draftFile=safeDraftFile(draftFile);
  }

  _traffic(){return this.trafficObservatory?.snapshot?.()||{recent:[]};}

  loadDraft() {
    try{
      const st=fs.lstatSync(this.draftFile);
      if(st.isSymbolicLink()||!st.isFile()) return {status:'invalid',reason:'draft_file_not_regular',draft:null};
      if(st.size>MAX_DRAFT_BYTES) return {status:'invalid',reason:'draft_file_too_large',draft:null};
      const parsed=JSON.parse(fs.readFileSync(this.draftFile,'utf8'));
      const checked=validateAiAgentPolicyDraft(parsed);
      return checked.valid?{status:'saved',reason:null,draft:checked.canonical}:{status:'invalid',reason:'draft_validation_failed',draft:null};
    }catch(err){
      if(err?.code==='ENOENT') return {status:'absent',reason:null,draft:null};
      return {status:'invalid',reason:'draft_read_failed',draft:null};
    }
  }

  snapshot() {
    const saved=this.loadDraft();
    return {
      version:1,available:true,authenticated:true,csrfProtectedWrites:true,
      current:currentAiAgentPolicyDraft(this.config),savedDraft:saved.draft,savedDraftStatus:saved.status,savedDraftReason:saved.reason,
      maxRules:MAX_RULES,maxPreviewDecisions:24,persistence:'private_local_draft',
      saveChangesRuntime:false,enforcementControlAvailable:false,exportForcesShadowMode:true,exportForcesEnforcementDisabled:true,
      privacy:{rawIp:false,rawUserAgent:false,rawPath:false,rawQuery:false,credentials:false}
    };
  }

  preview(input){return previewAiAgentPolicyDraft(input,this._traffic());}

  save(input) {
    const result=this.preview(input);
    if(!result.valid) return result;
    const dir=path.dirname(this.draftFile);fs.mkdirSync(dir,{recursive:true,mode:0o700});
    try{
      const existing=fs.lstatSync(this.draftFile);if(existing.isSymbolicLink()||!existing.isFile()) throw new Error('unsafe_draft_file');
    }catch(err){if(err?.code!=='ENOENT') throw err;}
    const temp=`${this.draftFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp,JSON.stringify(result.canonical,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.chmodSync(temp,0o600);fs.renameSync(temp,this.draftFile);
    return {...result,saved:true};
  }
}

export function createAiAgentPolicyManager(config={},trafficObservatory=null,options={}) {
  return new AiAgentPolicyManager(config,trafficObservatory,options);
}

export function describeAiAgentPolicyManager() {
  return {version:1,available:true,authenticated:true,csrfProtectedWrites:true,saveChangesRuntime:false,enforcementControlAvailable:false,exportForcesShadowMode:true,exportForcesEnforcementDisabled:true,maxRules:MAX_RULES,maxPreviewDecisions:24,rawIpExposed:false,rawUserAgentExposed:false};
}
