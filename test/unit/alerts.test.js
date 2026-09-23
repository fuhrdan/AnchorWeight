import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig} from '../../src/config.js';
import {validateConfig} from '../../src/config-schema.js';
import {validateAlertDocument,loadAlertDocument,publicIPv4,createAlerts,deliverWebhook} from '../../src/alerts.js';

const doc={version:1,webhooks:[{id:'ops',url:'https://alerts.example.com/hooks/aw'}],rules:[
 {id:'errors',kind:'upstream_error',route:'/',threshold:1,cooldownSeconds:60,webhook:'ops'},
 {id:'fives',kind:'high_5xx',route:'/api',threshold:3,cooldownSeconds:60,webhook:'ops'},
 {id:'down',kind:'circuit_open',route:'/',threshold:1,cooldownSeconds:60,webhook:'ops'},
 {id:'up',kind:'circuit_recovered',route:'/',threshold:1,cooldownSeconds:60,webhook:'ops'}]};
// Build a self-contained alerts fixture. HawkHost's test shell inherits live feature
// flags; a disabled dependency must also disable its related write/health toggle.
// Otherwise this test would inadvertently validate unrelated production settings.
const conf=()=>({...loadConfig({alertsEnabled:false,alertAllowedHosts:['alerts.example.com'],
  alertSigningKey:'a'.repeat(40),activeRoutes:[{path:'/api',origin:'http://127.0.0.1:8081/'}],routesEnabled:false,
  setupConfigEnabled:false,setupWritesEnabled:false,declarativeEnabled:false,declarativeWritesEnabled:false,
  appAuthEnabled:false,observatoryLiveEnabled:false,resilienceEnabled:false,resilienceHealthEnabled:false,
  intelligenceEnabled:false,trustedJa4Enabled:false,trustProxy:false}),alertsEnabled:true});
const tick=()=>new Promise(r=>setImmediate(r));
test('webhook destinations and rule schema reject SSRF, internal hosts, unknown or duplicate rules',()=>{
 assert.equal(validateAlertDocument(doc,conf()).rules.length,4);
 const bad=(url)=>({...doc,webhooks:[{id:'ops',url}]});
 for(const url of ['http://alerts.example.com/h','https://localhost/h','https://127.0.0.1/h',
  'https://user:pass@alerts.example.com/h','https://alerts.example.com:8443/h',
  'https://unapproved.example.com/h','https://alerts.example.com/h#fragment'])
  assert.throws(()=>validateAlertDocument(bad(url),conf()));
 assert.throws(()=>validateAlertDocument({...doc,rules:[doc.rules[0],doc.rules[0]]},conf()));
 assert.throws(()=>validateAlertDocument({...doc,rules:[{...doc.rules[0],webhook:'missing'}]},conf()));
});
test('reserved/private IPv4 cannot receive alerts; DNS resolution pinned to public IP',async()=>{
 for(const ip of ['127.0.0.1','10.5.1.1','172.16.0.1','192.168.0.1','169.254.169.254','100.64.1.2','192.0.2.1','203.0.113.1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('8.8.8.8'),true);
 let requests=0,received;
 const request=(url,opts,callback)=>{
  requests++;received={url:url.href,opts};
  const mock={on(_event){return mock;},end(_body){callback({statusCode:204,resume(){}});return mock;},destroy(){}};
  return mock;
 };
 const key=conf();
 await assert.rejects(deliverWebhook(doc.webhooks[0].url,'{"schema":1}',key,{lookup:async()=>[{address:'169.254.169.254',family:4}],request}),/webhook_dns_not_public/);
 assert.equal(requests,0);
});
test('DNS pinning and HMAC cover exact redacted body; redirects are not followed',async()=>{
 let got;
 const request=(url,opts,callback)=>{got={url,opts};const req={on(){return req;},end(){callback({statusCode:302,resume(){}})},destroy(){}};return req;};
 const ok=await deliverWebhook('https://alerts.example.com/hooks/aw','{"kind":"test"}',conf(),{lookup:async()=>[{address:'8.8.8.8',family:4}],request});
 assert.equal(ok,false);
 assert.equal(got.opts.headers['X-AnchorWeight-Signature'].startsWith('sha256='),true);
 await new Promise(resolve=>got.opts.lookup('alerts.example.com',{},(err,ip,family)=>{assert.equal(ip,'8.8.8.8');assert.equal(family,4);resolve();}));
});
test('enabled configuration loads only private bounded files; disabled ignores missing file',()=>{
 fs.mkdirSync(path.resolve(process.cwd(),'data'),{recursive:true});
 const tmp=fs.mkdtempSync(path.resolve(process.cwd(),'data','alerts-unit-'));
 const file=path.join(tmp,'alerts.json');try{
  fs.writeFileSync(file,JSON.stringify(doc),{mode:0o600});
  assert.equal(loadAlertDocument({...conf(),alertsFile:file}).rules.length,4);
  assert.equal(loadAlertDocument({...conf(),alertsEnabled:false,alertsFile:'/nonexistent.json'}),null);
  fs.chmodSync(file,0o644);if(process.platform!=='win32')assert.throws(()=>loadAlertDocument({...conf(),alertsFile:file}));
  fs.chmodSync(file,0o600);fs.writeFileSync(file,' '.repeat(17000));assert.throws(()=>loadAlertDocument({...conf(),alertsFile:file}));
  assert.throws(()=>loadAlertDocument({...conf(),alertsFile:'./otherdir/policy.json'}));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('disabled-by-default and enabled configuration validation',()=>{
 const c=conf();assert.equal(validateConfig(c).valid,true);
 assert.equal(validateConfig({...c,alertSigningKey:'short'}).valid,false);
 assert.equal(validateConfig({...c,alertsEnabled:false,alertSigningKey:''}).valid,true);
});
test('redacted response alerts, five-minute threshold, per-rule cooldown and transition hooks',async()=>{
 let time=1000000;const sent=[],seen=[];
 const alerts=createAlerts(conf(),{document:validateAlertDocument(doc,conf()),now:()=>time,
  send:async(url,body)=>{sent.push({url,payload:JSON.parse(body)});return true;},onAlert:e=>seen.push(e)});
 alerts.response({kind:'response',route:'/api',status:500,upstreamError:'timeout',
  ip:'TOP_SECRET',headers:{authorization:'TOP_SECRET'},path:'/api/token=TOP_SECRET'});
 alerts.response({kind:'response',route:'/api',status:500});
 alerts.response({kind:'response',route:'/api',status:500});
 alerts.circuit({kind:'circuit_open',route:'/api',origin:'http://TOP_SECRET/'});
 alerts.circuit({kind:'circuit_open',route:'/api'});
 await tick();await tick();
 assert.equal(alerts.snapshot().generated,3);
 assert.equal(alerts.snapshot().sent,3);
 assert.equal(sent.some(item=>JSON.stringify(item).includes('TOP_SECRET')),false);
 assert.equal(alerts.snapshot().recent.length,3);
 time+=61000;alerts.circuit({kind:'circuit_recovered',route:'/api'});await tick();await tick();
 assert.equal(alerts.snapshot().generated,4);
 alerts.stop();
});
test('failed delivery retries once and does not block a request',async()=>{
 let calls=0;
 const rules=validateAlertDocument({...doc,rules:[doc.rules[0]]},conf());
 const alert=createAlerts(conf(),{document:rules,send:async()=>{calls++;return false;}});
 alert.response({kind:'response',route:'(default)',status:502,upstreamError:'timeout'});
 await tick();await tick();await tick();
 assert.equal(calls,2);assert.equal(alert.snapshot().retried,1);assert.equal(alert.snapshot().failed,1);
 alert.stop();
});
