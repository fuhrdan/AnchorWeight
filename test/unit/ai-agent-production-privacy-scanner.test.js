import test from 'node:test';
import assert from 'node:assert/strict';
import { forbiddenAiData } from '../../scripts/ai-agent-production-check.js';

test('privacy false/null descriptors are not treated as leaks',()=>{
  assert.equal(forbiddenAiData({privacy:{rawIp:false,rawUserAgent:false,rawPath:false,rawQuery:false,credentials:false}}),null);
  assert.equal(forbiddenAiData({privacy:{rawIp:null,credentials:null}}),null);
});

test('populated sensitive values fail closed',()=>{
  assert.equal(forbiddenAiData({rawIp:'203.0.113.10'}),'rawIp');
  assert.equal(forbiddenAiData({nested:{rawUserAgent:'GPTBot/1.4'}}),'rawUserAgent');
  assert.equal(forbiddenAiData({credentials:{token:'secret'}}),'credentials');
  assert.equal(forbiddenAiData({authorization:'Bearer secret'}),'authorization');
});

test('ordinary bounded AI metadata remains allowed',()=>{
  assert.equal(forbiddenAiData({
    provider:'openai',family:'gptbot',purpose:'model_training',
    verificationStatus:'unavailable',action:'observe',outcome:'observed'
  }),null);
});
