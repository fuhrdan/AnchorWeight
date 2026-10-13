import test from 'node:test';
import assert from 'node:assert/strict';
import { observeTrafficIdentity } from '../../src/agent-identity.js';
function observe(ua){return observeTrafficIdentity({headers:{'user-agent':ua}});}

test('OAI-AdsBot is a declared OpenAI automation identity',()=>{const x=observe('OAI-AdsBot/1.0');assert.equal(x.provider,'openai');assert.equal(x.family,'oai-adsbot');assert.equal(x.purpose,'general_automation');});
test('PerplexityBot is search indexing',()=>{const x=observe('PerplexityBot/1.0');assert.equal(x.provider,'perplexity');assert.equal(x.family,'perplexitybot');assert.equal(x.purpose,'search_indexing');});
test('Perplexity-User is user retrieval',()=>{const x=observe('Perplexity-User/1.0');assert.equal(x.provider,'perplexity');assert.equal(x.family,'perplexity-user');assert.equal(x.purpose,'user_retrieval');});
test('Google-Agent is user-directed retrieval',()=>{const x=observe('Mozilla/5.0 (compatible; Google-Agent; +https://example.invalid)');assert.equal(x.provider,'google');assert.equal(x.family,'google-agent');assert.equal(x.purpose,'user_retrieval');});
test('Google-GeminiNotebook is user-directed retrieval',()=>{const x=observe('Mozilla/5.0 (compatible; Google-GeminiNotebook; +https://example.invalid)');assert.equal(x.provider,'google');assert.equal(x.family,'google-gemininotebook');assert.equal(x.purpose,'user_retrieval');});
test('legacy Google-NotebookLM maps to Gemini Notebook family',()=>{const x=observe('Google-NotebookLM');assert.equal(x.provider,'google');assert.equal(x.family,'google-gemininotebook');});
test('Google-CloudVertexBot is declared AI automation',()=>{const x=observe('Google-CloudVertexBot');assert.equal(x.provider,'google');assert.equal(x.family,'google-cloudvertexbot');assert.equal(x.purpose,'general_automation');});
