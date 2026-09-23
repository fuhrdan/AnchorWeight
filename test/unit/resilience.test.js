import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResilience, validateFallbacks, loadFallbacks } from '../../src/resilience.js';

const primary='http://127.0.0.1:8101/';
const secondary='http://127.0.0.1:8102/';
const baseline=overrides=>({ originUrl:primary, activeRoutes:[], proxyEnabled:true,
  resilienceEnabled:true, resilienceFailureThreshold:2, resilienceCooldownMs:1000,
  resilienceHealthEnabled:false, resilienceHealthIntervalMs:5000,
  resilienceHealthTimeoutMs:500, setupPublicHost:'aw.example.test',
  resilienceAllowedOrigins:[secondary], ...overrides });
const req=(method='GET',headers={})=>({method,headers});

test('fallback document requires approved independent origins and bounded exact mappings',()=>{
 const c=baseline();const doc={version:1,fallbacks:[{origin:primary,fallback:secondary}]};
 assert.equal(validateFallbacks(doc,c,[primary]).get(primary),secondary);
 for(const bad of [
  {version:1,fallbacks:[{origin:primary,fallback:'http://unapproved.test/'}]},
  {version:1,fallbacks:[{origin:primary,fallback:primary}]},
  {version:1,fallbacks:[{origin:'http://unapproved.test/',fallback:secondary}]},
  {version:1,fallbacks:[{origin:primary,fallback:secondary},{origin:primary,fallback:secondary}]},
  {version:1,fallbacks:[{origin:primary,fallback:secondary,unsafe:true}]},
  {version:1,fallbacks:Array.from({length:17},()=>({origin:primary,fallback:secondary}))}
 ])assert.throws(()=>validateFallbacks(bad,c,[primary]));
 assert.throws(()=>validateFallbacks(doc,baseline({resilienceAllowedOrigins:['http://aw.example.test/']}),[primary]));
});

test('private fallback file ignores disabled mode and rejects symlinks and public file permissions',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aw-resilience-'));
 const previous=process.cwd();
 try{
  process.chdir(tmp);fs.mkdirSync('data');
  const file='./data/fallbacks.json';
  assert.equal(loadFallbacks({...baseline(),resilienceEnabled:false,resilienceFallbackFile:file},[primary]).size,0);
  fs.writeFileSync(file,JSON.stringify({version:1,fallbacks:[{origin:primary,fallback:secondary}]}),{mode:0o600});
  assert.equal(loadFallbacks({...baseline(),resilienceFallbackFile:file},[primary]).size,1);
  fs.chmodSync(file,0o644);
  if(process.platform!=='win32')assert.throws(()=>loadFallbacks({...baseline(),resilienceFallbackFile:file},[primary]),/permissions/);
  fs.chmodSync(file,0o600);fs.symlinkSync('fallbacks.json','data/link.json');
  if(fs.constants.O_NOFOLLOW)assert.throws(()=>loadFallbacks({...baseline(),resilienceFallbackFile:'./data/link.json'},[primary]));
  assert.throws(()=>loadFallbacks({...baseline(),resilienceFallbackFile:'../fallbacks.json'},[primary]));
 }finally{process.chdir(previous);fs.rmSync(tmp,{force:true,recursive:true});}
});

test('breaker opens on 5xx/transport failures and only routes fresh bodyless reads to fallback',()=>{
 let time=1000;
 const m=createResilience(baseline(),{now:()=>time,fallbacks:new Map([[primary,secondary]])});
 assert.equal(m.choose(primary,req()),primary);
 m.response(primary,503);
 assert.equal(m.choose(primary,req('POST')),primary);
 m.failure(primary);
 assert.equal(m.choose(primary,req()),secondary);
 assert.equal(m.choose(primary,req('HEAD')),secondary);
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(m.choose(primary,req(method)),null);
 assert.equal(m.choose(primary,req('GET',{'content-length':'1'})),null);
 assert.equal(m.snapshot().fallbackSelections,2);
 time+=1001;
 assert.equal(m.choose(primary,req()),primary,'one half-open probe allowed');
 assert.equal(m.choose(primary,req()),secondary,'other readers use fallback');
 m.response(primary,200);
 assert.equal(m.choose(primary,req('POST')),primary);
 assert.equal(m.snapshot().origins.find(o=>o.path==='/ (default)').state,'closed');
});

test('disabled circuit breaker never changes request routing, and per-origin health is separate',()=>{
 const disabled=createResilience(baseline({resilienceEnabled:false}));
 disabled.failure(primary);assert.equal(disabled.choose(primary,req('POST')),primary);
 const routes=[{path:'/api',origin:'http://127.0.0.1:8201/'}];
 const c=baseline({activeRoutes:routes});const m=createResilience(c);
 m.failure(primary);m.failure(primary);
 assert.equal(m.choose(routes[0].origin,req()),routes[0].origin);
 assert.equal(m.choose(primary,req()),null);
 assert.equal(m.snapshot().origins.length,2);
});

test('health probes are bounded, recover circuits, and never require live network in tests',async()=>{
 let active=0,max=0;
 const config=baseline({resilienceHealthEnabled:true,activeRoutes:[{path:'/api',origin:'http://127.0.0.1:8201/'}]});
 const r=createResilience(config,{requestHttp:(origin,opts,callback)=>{
  const events=new Map();active++;max=Math.max(max,active);
  return {once(name,fn){events.set(name,fn);return this;},end(){
   queueMicrotask(()=>{active--;callback({statusCode:200,resume(){}});});
  },destroy(error){events.get('error')?.(error);}};
 }});
 await r.probeAll();
 assert.ok(max<=2);
 assert.equal(r.snapshot().origins.length,2);
 assert.ok(r.snapshot().origins.every(o=>o.lastStatus===200));
 r.stop();
});

test('legacy proxy paths remain valid when resilience is disabled',()=>{
 const c=baseline({resilienceEnabled:false,originUrl:'http://127.0.0.1:8101/subdir'});
 const m=createResilience(c);
 assert.equal(m.choose(c.originUrl,req()),'http://127.0.0.1:8101/subdir');
});
