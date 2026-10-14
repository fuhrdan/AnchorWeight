import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  currentAiAgentPolicyDraft,
  validateAiAgentPolicyDraft,
  exportAiAgentPolicyEnvironment
} from './ai-agent-policy-manager.js';

export const AI_AGENT_POLICY_DEPLOYMENT_SCHEMA='anchorweight-ai-agent-policy-deployment/v1';
export const AI_AGENT_POLICY_PREPARE_CONFIRMATION='PREPARE SHADOW DEPLOYMENT';
export const AI_AGENT_POLICY_ROLLBACK_CONFIRMATION='PREPARE SHADOW ROLLBACK';

const DEFAULT_SHADOW_ENV='./data/ai-agent-policy-shadow.env';
const DEFAULT_ROLLBACK_DRAFT='./data/ai-agent-policy-rollback.json';
const DEFAULT_ROLLBACK_ENV='./data/ai-agent-policy-rollback.env';
const DEFAULT_METADATA='./data/ai-agent-policy-deployment.json';
const MAX_FILE_BYTES=32768;

function stable(value) {
  if(Array.isArray(value)) return value.map(stable);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex').slice(0,24);
}

function arr(value) { return Array.isArray(value)?value:[]; }
function indexRules(values,verification=false) {
  const out=new Map();
  for(const rule of arr(values)) {
    const m=verification
      ? String(rule).match(/^([a-z0-9_-]{2,32}):([a-z0-9_-]{2,64})@(verified|unverified|unavailable|disabled)=(allow|observe|deny)$/)
      : String(rule).match(/^([a-z0-9_-]{2,32}):([a-z0-9_-]{2,64})=(allow|observe|deny)$/);
    if(!m) continue;
    const key=verification?`${m[1]}:${m[2]}@${m[3]}`:`${m[1]}:${m[2]}`;
    out.set(key,m.at(-1));
  }
  return out;
}

function diffRules(current,candidate,verification=false) {
  const a=indexRules(current,verification),b=indexRules(candidate,verification),changes=[];
  const keys=[...new Set([...a.keys(),...b.keys()])].sort();
  for(const key of keys) {
    const before=a.get(key)??null,after=b.get(key)??null;
    if(before===after) continue;
    changes.push({key,before,after,kind:before==null?'added':after==null?'removed':'changed'});
  }
  return changes.slice(0,64);
}

export function compareAiAgentPolicies(current,candidate) {
  const purposeChanges=[];
  for(const key of ['modelTraining','searchIndexing','userRetrieval','generalAutomation']) {
    const before=current?.purposeActions?.[key]??'observe';
    const after=candidate?.purposeActions?.[key]??'observe';
    if(before!==after) purposeChanges.push({purpose:key,before,after});
  }
  const familyChanges=diffRules(current?.familyRules,candidate?.familyRules,false);
  const verificationChanges=diffRules(current?.verificationRules,candidate?.verificationRules,true);
  return {
    purposeChanges,familyChanges,verificationChanges,
    changeCount:purposeChanges.length+familyChanges.length+verificationChanges.length
  };
}

function risk(code,severity,detail) { return {code,severity,detail}; }

export function assessAiAgentDeploymentRisk(candidate,preview,diff) {
  const risks=[];
  const changes=arr(preview?.changes);
  const denyEscalations=changes.filter(x=>x.candidateAction==='deny' && x.currentAction!=='deny').length;
  const allowExpansions=changes.filter(x=>x.candidateAction==='allow' && x.currentAction!=='allow').length;
  if((preview?.sampleSize??0)===0) risks.push(risk('no_observed_sample','medium','No recent AI-agent decisions are available for rehearsal.'));
  if(denyEscalations>0) risks.push(risk('observed_deny_expansion','high',`${denyEscalations} observed decision(s) would newly become deny in shadow rehearsal.`));
  if(allowExpansions>0) risks.push(risk('observed_allow_expansion','medium',`${allowExpansions} observed decision(s) would newly become allow; allow still grants no trust.`));
  if(candidate?.purposeActions?.userRetrieval==='deny') risks.push(risk('user_retrieval_default_deny','medium','User-directed retrieval is denied by default in the candidate policy.'));
  if(candidate?.purposeActions?.searchIndexing==='deny') risks.push(risk('search_indexing_default_deny','medium','AI search indexing is denied by default in the candidate policy.'));
  for(const rule of arr(candidate?.verificationRules)) {
    if(/@unavailable=allow$/.test(rule)) risks.push(risk('unavailable_verification_allow','high',`${rule} allows when provider verification is unavailable.`));
    if(/(?:oai-searchbot|claude-searchbot|perplexitybot).*@verified=deny$/.test(rule)) risks.push(risk('verified_search_deny','high',`${rule} denies a verified search-oriented family.`));
  }
  if((diff?.changeCount??0)>8) risks.push(risk('large_policy_change','medium',`${diff.changeCount} policy entries change at once.`));
  const order={high:0,medium:1,low:2};
  return risks.sort((a,b)=>(order[a.severity]??9)-(order[b.severity]??9)||a.code.localeCompare(b.code)).slice(0,24);
}

function safeReadJson(file) {
  try {
    const st=fs.lstatSync(file);
    if(st.isSymbolicLink()||!st.isFile()||st.size>MAX_FILE_BYTES) return null;
    return JSON.parse(fs.readFileSync(file,'utf8'));
  } catch { return null; }
}

function atomicWrite(file,content) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  try { const st=fs.lstatSync(file); if(st.isSymbolicLink()||!st.isFile()) throw new Error('unsafe_target_file'); } catch(err) { if(err?.code!=='ENOENT') throw err; }
  const temp=`${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp,content,{mode:0o600,flag:'wx'});
  fs.chmodSync(temp,0o600);
  fs.renameSync(temp,file);
}

function publicFile(file) {
  const normalized=String(file).replaceAll('\\','/');
  const idx=normalized.lastIndexOf('/data/');
  return idx>=0?normalized.slice(idx+1):path.basename(normalized);
}

export class AiAgentPolicyDeployment {
  constructor(config={},policyManager=null,trafficObservatory=null,options={}) {
    this.config=config;this.policyManager=policyManager;this.trafficObservatory=trafficObservatory;
    this.shadowEnv=path.resolve(options.shadowEnvFile||DEFAULT_SHADOW_ENV);
    this.rollbackDraft=path.resolve(options.rollbackDraftFile||DEFAULT_ROLLBACK_DRAFT);
    this.rollbackEnv=path.resolve(options.rollbackEnvFile||DEFAULT_ROLLBACK_ENV);
    this.metadata=path.resolve(options.metadataFile||DEFAULT_METADATA);
  }

  _current(){return currentAiAgentPolicyDraft(this.config);}
  _saved(){return this.policyManager?.loadDraft?.()||{status:'absent',draft:null};}
  _preview(draft){return this.policyManager?.preview?.(draft)||{valid:false,errors:['policy_manager_unavailable'],warnings:[],preview:null,environment:null,canonical:null};}

  plan() {
    const saved=this._saved();
    if(saved.status!=='saved'||!saved.draft) return {
      schema:AI_AGENT_POLICY_DEPLOYMENT_SCHEMA,available:true,deployable:false,verdict:'blocked',reason:'saved_draft_required',
      planId:null,current:this._current(),candidate:null,diff:null,rehearsal:null,risks:[],environment:null,
      automaticActivation:false,automaticRestart:false,enforcementControlAvailable:false
    };
    const checked=validateAiAgentPolicyDraft(saved.draft);
    if(!checked.valid) return {schema:AI_AGENT_POLICY_DEPLOYMENT_SCHEMA,available:true,deployable:false,verdict:'blocked',reason:'saved_draft_invalid',planId:null,current:this._current(),candidate:null,diff:null,rehearsal:null,risks:[],environment:null,automaticActivation:false,automaticRestart:false,enforcementControlAvailable:false};
    const current=this._current(),candidate=checked.canonical,preview=this._preview(candidate);
    const diff=compareAiAgentPolicies(current,candidate);
    const risks=assessAiAgentDeploymentRisk(candidate,preview.preview,diff);
    const highRisk=risks.some(r=>r.severity==='high');
    const planCore={current,candidate,diff,rehearsal:preview.preview,risks};
    const planId=hash(planCore);
    return {
      schema:AI_AGENT_POLICY_DEPLOYMENT_SCHEMA,available:true,deployable:true,
      verdict:highRisk?'review_required':'ready_for_shadow_prepare',reason:null,planId,...planCore,
      environment:exportAiAgentPolicyEnvironment(candidate),warnings:preview.warnings||[],
      shadowOnly:true,requiresExplicitConfirmation:true,highRiskAcknowledgementRequired:highRisk,
      automaticActivation:false,automaticRestart:false,enforcementControlAvailable:false,
      activationInstructions:[
        'Review the generated shadow environment and rollback snapshot.',
        'Apply the generated AW_AI_AGENT_* values to the hosting environment.',
        'Restart the Node/Passenger application using the hosting control plane.',
        'Verify the dashboard reports the expected shadow policy and inspect AI-agent observability.',
        'Do not enable active deny enforcement during the alpha.6 rehearsal.'
      ]
    };
  }

  _metadata(){return safeReadJson(this.metadata);}
  _rollback(){const raw=safeReadJson(this.rollbackDraft);const checked=raw?validateAiAgentPolicyDraft(raw):null;return checked?.valid?checked.canonical:null;}

  snapshot() {
    const plan=this.plan(),meta=this._metadata(),rollback=this._rollback();
    return {
      version:1,available:true,authenticated:true,csrfProtectedWrites:true,plan,
      prepared:!!meta,preparedPlanId:meta?.planId||null,preparedAt:meta?.preparedAt||null,
      rollbackAvailable:!!rollback,
      artifacts:{shadowEnvironment:publicFile(this.shadowEnv),rollbackDraft:publicFile(this.rollbackDraft),rollbackEnvironment:publicFile(this.rollbackEnv),metadata:publicFile(this.metadata)},
      automaticActivation:false,automaticRestart:false,changesRuntime:false,enforcementControlAvailable:false,
      prepareConfirmation:AI_AGENT_POLICY_PREPARE_CONFIRMATION,
      rollbackConfirmation:AI_AGENT_POLICY_ROLLBACK_CONFIRMATION
    };
  }

  prepare(input={}) {
    const plan=this.plan();
    if(!plan.deployable) return {ok:false,error:'deployment_plan_not_deployable',plan};
    if(String(input.planId||'')!==plan.planId) return {ok:false,error:'deployment_plan_changed',plan};
    if(String(input.confirmation||'')!==AI_AGENT_POLICY_PREPARE_CONFIRMATION) return {ok:false,error:'deployment_confirmation_required',plan};
    if(plan.highRiskAcknowledgementRequired && input.acknowledgeRisks!==true) return {ok:false,error:'deployment_risk_acknowledgement_required',plan};
    const rollback=this._current();
    const rollbackChecked=validateAiAgentPolicyDraft(rollback);
    if(!rollbackChecked.valid) return {ok:false,error:'rollback_snapshot_invalid',plan};
    atomicWrite(this.rollbackDraft,JSON.stringify(rollbackChecked.canonical,null,2)+'\n');
    atomicWrite(this.shadowEnv,plan.environment);
    const meta={schema:AI_AGENT_POLICY_DEPLOYMENT_SCHEMA,planId:plan.planId,preparedAt:new Date().toISOString(),mode:'shadow_only',requiresRestart:true,changesRuntime:false,enforcementEnabled:false};
    atomicWrite(this.metadata,JSON.stringify(meta,null,2)+'\n');
    return {ok:true,prepared:true,plan,metadata:meta,changesRuntime:false,restartPerformed:false,enforcementEnabled:false};
  }

  prepareRollback(input={}) {
    if(String(input.confirmation||'')!==AI_AGENT_POLICY_ROLLBACK_CONFIRMATION) return {ok:false,error:'rollback_confirmation_required'};
    const rollback=this._rollback();
    if(!rollback) return {ok:false,error:'rollback_snapshot_unavailable'};
    const environment=exportAiAgentPolicyEnvironment(rollback);
    atomicWrite(this.rollbackEnv,environment);
    return {ok:true,prepared:true,environment,changesRuntime:false,restartPerformed:false,enforcementEnabled:false};
  }
}

export function createAiAgentPolicyDeployment(config={},policyManager=null,trafficObservatory=null,options={}) {
  return new AiAgentPolicyDeployment(config,policyManager,trafficObservatory,options);
}

export function describeAiAgentPolicyDeployment() {
  return {
    version:1,available:true,authenticated:true,csrfProtectedWrites:true,
    exactPlanConfirmation:true,rollbackSnapshot:true,shadowOnlyPreparation:true,
    automaticActivation:false,automaticRestart:false,changesRuntime:false,enforcementControlAvailable:false,
    prepareConfirmation:AI_AGENT_POLICY_PREPARE_CONFIRMATION,rollbackConfirmation:AI_AGENT_POLICY_ROLLBACK_CONFIRMATION,
    rawIpExposed:false,rawUserAgentExposed:false,credentialsExposed:false
  };
}
