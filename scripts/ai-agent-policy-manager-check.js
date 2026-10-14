#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { validateAiAgentPolicyDraft,previewAiAgentPolicyDraft,exportAiAgentPolicyEnvironment,describeAiAgentPolicyManager,AI_AGENT_POLICY_DRAFT_SCHEMA } from '../src/ai-agent-policy-manager.js';
import { createAgentPassport } from '../src/agent-passport.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function draft(overrides={}){return {schema:AI_AGENT_POLICY_DRAFT_SCHEMA,purposeActions:{modelTraining:'deny',searchIndexing:'allow',userRetrieval:'observe',generalAutomation:'observe'},familyRules:[],verificationRules:[],...overrides};}
export function runAiAgentPolicyManagerCheck({root=ROOT}={}){
 const failures=[];let checks=0;const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};
 check(ANCHORWEIGHT_VERSION==='3.1.0-rc.1','runtime version must be 3.1.0-rc.1');
 check(ANCHORWEIGHT_RELEASE_CHANNEL==='rc','release channel must be beta');
 const good=validateAiAgentPolicyDraft(draft());check(good.valid,'baseline draft must validate');check(good.canonical?.schema===AI_AGENT_POLICY_DRAFT_SCHEMA,'canonical schema mismatch');
 const bad=validateAiAgentPolicyDraft({...draft(),enforcementEnabled:true});check(!bad.valid,'manager must reject enforcement field');
 const dup=validateAiAgentPolicyDraft(draft({familyRules:['openai:gptbot=allow','openai:gptbot=deny']}));check(!dup.valid,'conflicting duplicate rules must fail');
 const unavailable=validateAiAgentPolicyDraft(draft({verificationRules:['openai:gptbot@unavailable=allow']}));check(unavailable.warnings.length>0,'unavailable allow must warn');
 const preview=previewAiAgentPolicyDraft(draft(),{recent:[{provider:'openai',family:'gptbot',purpose:'model_training',verificationStatus:'verified',action:'observe',policySource:'declaration_policy'}]});
 check(preview.valid && preview.preview.sampleSize===1,'bounded preview failed');check(preview.preview.enforcement===false && preview.preview.shadowOnly===true,'preview must be non-enforcing');check(preview.preview.outcomes.would_deny===1,'preview deny must be would-deny');
 const env=exportAiAgentPolicyEnvironment(draft());check(env.includes('AW_AI_AGENT_POLICY_SHADOW_MODE=true'),'export must force shadow mode');check(env.includes('AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=false'),'export must force enforcement disabled');check(!env.includes('AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=true'),'export must never enable enforcement');
 const desc=describeAiAgentPolicyManager();check(desc.authenticated===true && desc.csrfProtectedWrites===true,'manager auth/CSRF contract missing');check(desc.saveChangesRuntime===false,'saved draft must not change runtime');check(desc.enforcementControlAvailable===false,'manager must not expose enforcement control');
 const passport=createAgentPassport({});check(passport.capabilities?.aiAgentControls?.version===10,'Agent Passport must publish AI Agent Controls v5');check(passport.capabilities?.aiAgentControls?.policyManager?.available===true,'passport must publish policy manager');check(passport.capabilities?.aiAgentControls?.policyManager?.enforcementControlAvailable===false,'passport must say manager cannot enable enforcement');
 for(const file of ['src/ai-agent-policy-manager.js','test/unit/ai-agent-policy-manager.test.js','test/unit/ai-agent-policy-manager-integration.test.js','scripts/ai-agent-policy-manager-check.js','AI-AGENT-POLICY-MANAGER.md','V3.1.0-ALPHA5-RELEASE-NOTES.md'])check(fs.existsSync(path.join(root,file)),`missing alpha.5 artifact ${file}`);
 const anchor=fs.readFileSync(path.join(root,'src/anchorweight.js'),'utf8');check(anchor.includes('createAiAgentPolicyManager'),'runtime policy-manager wiring missing');check(anchor.includes('/api/ai-agents/policy-manager'),'policy-manager API missing');check(anchor.includes('validateCsrf'),'policy-manager writes must be CSRF protected');
 const dash=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');check(dash.includes('AI Agent Policy Manager'),'dashboard policy-manager panel missing');check(dash.includes('policyManagerPreview'),'dashboard preview control missing');check(dash.includes('policyManagerSave'),'dashboard save-draft control missing');check(dash.includes('AW_AI_AGENT_POLICY_ENFORCEMENT_ENABLED=false'),'dashboard safety explanation missing');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));check(pkg.scripts?.['ai-agents:policy-manager-check']==='node scripts/ai-agent-policy-manager-check.js','package policy-manager check missing');
 return {ok:failures.length===0,checks,failures};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const r=runAiAgentPolicyManagerCheck();if(!r.ok){for(const f of r.failures)console.error('FAIL:',f);process.exit(1);}console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} AI Agent Policy Manager PASS (${r.checks} invariants checked)`);}
