import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAiAgentRequestPolicy, buildAiAgentRobots, parseAiAgentFamilyRules } from '../../src/ai-agent-policy.js';

function req(ua){return {headers:{'user-agent':ua}};}
function cfg(overrides={}){return {aiAgentPolicyEnabled:true,aiAgentPolicyShadowMode:true,aiAgentPolicyEnforcementEnabled:false,aiAgentTrainingAction:'observe',aiAgentSearchAction:'observe',aiAgentUserAction:'observe',aiAgentAutomationAction:'observe',aiAgentFamilyRules:[],...overrides};}

test('AI Agent Controls ignore ordinary browsers',()=>{const d=evaluateAiAgentRequestPolicy(req('Mozilla/5.0'),cfg());assert.equal(d.matched,false);assert.equal(d.enforcementEligible,false);});
test('training deny is shadow-only by default',()=>{const d=evaluateAiAgentRequestPolicy(req('GPTBot/1.4'),cfg({aiAgentTrainingAction:'deny'}));assert.equal(d.action,'deny');assert.equal(d.enforcement,'shadow_only');assert.equal(d.enforcementEligible,false);});
test('explicit request-scoped deny can enforce without trusted client identity',()=>{const d=evaluateAiAgentRequestPolicy(req('GPTBot/1.4'),cfg({aiAgentTrainingAction:'deny',aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}));assert.equal(d.enforcementEligible,true);assert.equal(d.trustGranted,false);});
test('allow never grants trust',()=>{const d=evaluateAiAgentRequestPolicy(req('OAI-SearchBot/1.4'),cfg({aiAgentSearchAction:'allow',aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}));assert.equal(d.action,'allow');assert.equal(d.trustGranted,false);assert.equal(d.enforcementEligible,false);});
test('robots.txt remains readable by an otherwise denied declared agent',()=>{const d=evaluateAiAgentRequestPolicy(req('GPTBot/1.4'),cfg({aiAgentTrainingAction:'deny',aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}),{pathname:'/robots.txt'});assert.equal(d.enforcementEligible,false);assert.equal(d.reason,'robots_discovery_allowed');});
test('family override wins over purpose action',()=>{const d=evaluateAiAgentRequestPolicy(req('ChatGPT-User/1.0'),cfg({aiAgentUserAction:'allow',aiAgentFamilyRules:['openai:chatgpt-user=deny'],aiAgentPolicyShadowMode:false,aiAgentPolicyEnforcementEnabled:true}));assert.equal(d.action,'deny');assert.equal(d.enforcementEligible,true);});
test('invalid family rules are bounded and do not enforce',()=>{const parsed=parseAiAgentFamilyRules(['bad rule','openai:gptbot=launch']);assert.equal(parsed.rules.size,0);assert.equal(parsed.invalid.length,2);});
test('training robots guidance blocks Google-Extended without blocking Googlebot',()=>{const text=buildAiAgentRobots(cfg({aiAgentTrainingAction:'deny'}));assert.match(text,/User-agent: Google-Extended\nDisallow: \//);assert.doesNotMatch(text,/User-agent: Googlebot\n/);});
test('user-directed deny includes Claude-User and Perplexity-User robots guidance',()=>{const text=buildAiAgentRobots(cfg({aiAgentUserAction:'deny'}));assert.match(text,/Claude-User/);assert.match(text,/Perplexity-User/);});
