import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentPassport, handleAgentPassport } from '../../src/agent-passport.js';

function response(){
  const headers={};
  return {statusCode:0,headers,body:null,setHeader(k,v){headers[k.toLowerCase()]=String(v)},end(v=''){this.body=String(v)}};
}

test('passport advertises canonical and base-path fallback endpoints',()=>{
  const p=createAgentPassport({basePath:'/anchor'});
  assert.equal(p.endpoint,'/.well-known/anchorweight');
  assert.equal(p.fallbackEndpoint,'/anchor/agent-passport');
  assert.deepEqual(p.discovery.endpoints,['/.well-known/anchorweight','/anchor/agent-passport']);
});

test('base-path fallback serves the same public passport',()=>{
  const res=response();
  const handled=handleAgentPassport({method:'GET'},res,new URL('https://example.test/anchor/agent-passport'),{basePath:'/anchor'});
  assert.equal(handled,true);
  assert.equal(res.statusCode,200);
  const body=JSON.parse(res.body);
  assert.equal(body.version,'3.0.0');
  assert.equal(body.privacy.originExposed,false);
});

test('custom base path produces a matching passport fallback',()=>{
  const p=createAgentPassport({basePath:'/aw'});
  assert.equal(p.fallbackEndpoint,'/aw/agent-passport');
  const res=response();
  assert.equal(handleAgentPassport({method:'HEAD'},res,new URL('https://example.test/aw/agent-passport'),{basePath:'/aw'}),true);
  assert.equal(res.statusCode,200);
  assert.equal(res.body,'');
});
