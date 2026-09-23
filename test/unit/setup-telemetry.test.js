import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { loadConfig } from '../../src/config.js';
import { canonicalOrigin,allowedOrigins,validateOperatorSettings,readOperatorSettings,createSetupController } from '../../src/setup.js';
import { createTrafficTelemetry } from '../../src/telemetry.js';
import { createAnchorWeight } from '../../src/anchorweight.js';
import { MemoryStore } from '../../src/store.js';

function fixture(t,extra={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-setup-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'data','operator.json');
  const config=loadConfig({
    secret:'test-secret-persistent', dashboardToken:'local-private-token', dashboardEnabled:true,
    setupConfigEnabled:true,setupWritesEnabled:true,
    // Isolate this legacy setup fixture from unrelated cPanel routing flags.
    routesEnabled:false,declarativeEnabled:false,
    setupBaselineOrigin:'http://127.0.0.1:9999',
    setupAllowedOrigins:['https://origin.example:8443/'],
    originUrl:'http://127.0.0.1:9999',proxyEnabled:false,
    logFile:path.join(dir,'events.jsonl'),auditEnabled:false,
    ...extra
  });
  return {dir,file,config};
}
test('origin validator accepts only strict HTTP(S) roots with no credentials or URL extras',()=>{
  assert.equal(canonicalOrigin('https://origin.example:443/'),'https://origin.example/');
  for(const origin of ['','file:///etc/passwd','http://user:pass@localhost/','http://127.0.0.1:1234/metadata',
    'https://example.test/?debug=1','https://example.test/#x','https://example.test/evil','http://localhost\n.example'])
    assert.throws(()=>canonicalOrigin(origin),{message:'invalid_origin'},origin);
});
test('setup validates exact cPanel-approved origins and rejects extra fields',t=>{
  const {config}=fixture(t);
  assert.deepEqual(allowedOrigins(config),['http://127.0.0.1:9999/','https://origin.example:8443/']);
  assert.deepEqual(validateOperatorSettings(config,{proxyEnabled:true,originUrl:'https://origin.example:8443/'}),
    {proxyEnabled:true,originUrl:'https://origin.example:8443/'});
  for(const input of [
    {originUrl:'http://169.254.169.254/',proxyEnabled:true},
    {originUrl:'https://origin.example:8443/',proxyEnabled:'true'},
    {originUrl:'https://origin.example:8443/',proxyEnabled:true,secret:'steal'},
    {originUrl:'https://origin.example:8443/@evil',proxyEnabled:false}])
    assert.throws(()=>validateOperatorSettings(config,input));
});
test('operator settings are opt-in, atomic, mode 0600, restart compatible, and narrowly scoped',t=>{
  const {config,file}=fixture(t);
  let prepared=0,activated=0;
  const ctl=createSetupController(config,{file,onActivate:settings=>{
    prepared++;
    return ()=>{activated++;Object.assign(config,settings);};
  }});
  assert.equal(ctl.snapshot().writesEnabled,true);
  assert.equal(ctl.validate({originUrl:'http://127.0.0.1:9999/',proxyEnabled:true}).change,true);
  assert.equal(fs.existsSync(file),false,'validate must not save or activate');
  ctl.apply({originUrl:'http://127.0.0.1:9999/',proxyEnabled:true});
  assert.equal(prepared,1);assert.equal(activated,1);
  assert.equal(config.proxyEnabled,true);
  assert.equal(fs.statSync(file).mode & 0o777,0o600);
  assert.deepEqual(readOperatorSettings(config,file),{originUrl:'http://127.0.0.1:9999/',proxyEnabled:true});
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file,'utf8')).settings).sort(),['originUrl','proxyEnabled']);
  config.setupConfigEnabled=false;
  assert.equal(readOperatorSettings(config,file),null);
});
test('failed preparation and disabled writes do not mutate live routing or saved file',t=>{
  const {config,file}=fixture(t);
  const ctl=createSetupController(config,{file,onActivate:()=>{throw Error('upstream_failed');}});
  assert.throws(()=>ctl.apply({originUrl:'http://127.0.0.1:9999/',proxyEnabled:true}),/upstream_failed/);
  assert.equal(config.proxyEnabled,false);assert.equal(fs.existsSync(file),false);
  config.setupWritesEnabled=false;
  assert.throws(()=>ctl.apply({originUrl:'http://127.0.0.1:9999/',proxyEnabled:true}),/setup_write_disabled/);
  assert.equal(fs.existsSync(file),false);
});
test('invalid saved configuration is ignored rather than disabling the application',t=>{
  const {config,file}=fixture(t);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file,JSON.stringify({version:1,settings:{originUrl:'http://169.254.169.254/',proxyEnabled:true}}));
  const original=console.warn;console.warn=()=>{};
  try{assert.equal(readOperatorSettings(config,file),null);}finally{console.warn=original;}
  assert.equal(config.proxyEnabled,false);
});
test('telemetry counts response classes, origin first-response timing and active requests without request identities',()=>{
  let clock=60_000;
  const tel=createTrafficTelemetry({now:()=>clock});
  function newRequest(status){const res=new EventEmitter();res.statusCode=status;const req={url:'/sensitive',headers:{authorization:'secret'}};return {req,res,ctx:tel.begin(req,res)};}
  const a=newRequest(200);a.ctx.markProxied();a.ctx.upstreamStart();clock+=10;
  a.ctx.upstreamResponse(200);assert.equal(tel.snapshot().activeUpstream,1);
  clock+=20;a.ctx.upstreamEnd();a.res.emit('finish');a.res.emit('close');
  const b=newRequest(502);b.ctx.markProxied();b.ctx.upstreamStart();clock+=5;b.ctx.upstreamFailure();b.res.emit('close');
  const c=newRequest(404);clock+=5;c.res.emit('finish');
  const snap=tel.snapshot();
  assert.equal(snap.totalRequests,3);assert.equal(snap.proxiedRequests,2);
  assert.equal(snap.upstreamResponses,1);assert.equal(snap.upstreamFailures,1);
  assert.equal(snap.activeRequests,0);assert.equal(snap.activeUpstream,0);
  assert.equal(snap.statuses['2xx'],1);assert.equal(snap.statuses['4xx'],1);assert.equal(snap.statuses['5xx'],1);
  assert.equal(snap.avgUpstreamMs,10);
  assert.equal(snap.trend.reduce((n,b)=>n+b.requests,0),3);
  assert.doesNotMatch(JSON.stringify(snap),/secret|sensitive/);
  clock+=61*60_000;
  assert.equal(tel.snapshot().trend.reduce((n,b)=>n+b.requests,0),0);
  assert.equal(tel.snapshot().totalRequests,3,'lifetime counters do not reset at bucket expiration');
});
function mock(method,url,headers={}) {
  const req=new EventEmitter();req.method=method;req.headers=headers;req.socket={remoteAddress:'127.0.0.1'};
  const res={statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},
    end(v=''){this.body=String(v);this.resolve?.();}};
  const done=new Promise(resolve=>res.resolve=resolve);
  return {req,res,done,url:new URL(url)};
}
test('setup APIs require bearer authentication and CSRF and never expose secrets',async t=>{
  const {config,file}=fixture(t);const store=new MemoryStore();
  const setup=createSetupController(config,{file,onActivate:settings=>()=>Object.assign(config,settings)});
  const telemetry=createTrafficTelemetry();
  const aw=createAnchorWeight(config,{store,setup,telemetry,log:()=>{},audit:()=>{}});
  async function call(method,pathname,headers={},body=null){
    const q=mock(method,'http://localhost'+pathname,headers);
    aw.handle(q.req,q.res,q.url);
    if(body!==null){q.req.emit('data',Buffer.from(JSON.stringify(body)));q.req.emit('end');}
    await q.done;return q.res;
  }
  assert.equal((await call('GET','/anchor/api/setup')).statusCode,401);
  const auth={authorization:'Bearer local-private-token'};
  const read=await call('GET','/anchor/api/setup',auth);
  assert.equal(read.statusCode,200);assert.doesNotMatch(read.body,/test-secret-persistent|local-private-token/);
  assert.equal((await call('POST','/anchor/api/setup/apply',auth,{proxyEnabled:true,originUrl:'http://127.0.0.1:9999/'})).statusCode,403);
  const session=JSON.parse((await call('GET','/anchor/api/session',auth)).body);
  const headers={...auth,'x-aw-csrf':session.csrfToken};
  const bad=await call('POST','/anchor/api/setup/validate',headers,{proxyEnabled:true,originUrl:'http://169.254.169.254/'});
  assert.equal(bad.statusCode,400);
  const ok=await call('POST','/anchor/api/setup/apply',headers,{proxyEnabled:true,originUrl:'http://127.0.0.1:9999/'});
  assert.equal(ok.statusCode,200);assert.equal(config.proxyEnabled,true);
  assert.equal(JSON.parse((await call('GET','/anchor/api/stats',auth)).body).telemetry.totalRequests,0);
});
