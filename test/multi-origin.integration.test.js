import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createReverseProxy} from '../src/proxy.js';
const app=fileURLToPath(new URL('../app.js',import.meta.url));
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function waitLive(port,child){for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error('failed startup: '+child.errors);
  try{const r=await fetch(`http://127.0.0.1:${port}/live`);if(r.ok)return r.json();}catch{}
  await new Promise(resolve=>setTimeout(resolve,50));
}throw Error('startup timeout: '+child.errors);}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGKILL');await done;}
test('cPanel-style multi-origin routing, fallback, query, proxy hot-switch and readiness',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-multi-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const mk=name=>http.createServer((req,res)=>{res.setHeader('Content-Type','text/plain');res.end(`${name} ${req.method} ${req.url}`);});
 const a=mk('API'),b=mk('STATIC'),c=mk('DEFAULT'),d=mk('CHANGED');
 const ports=await Promise.all([listen(a),listen(b),listen(c),listen(d)]);
 
 const [ap,bp,cp,dp]=ports;const target=`http://127.0.0.1:${cp}/`;
 fs.mkdirSync(path.join(dir,'data'));
 fs.writeFileSync(path.join(dir,'data','anchorweight-routes.json'),JSON.stringify({version:1,routes:[
  {path:'/api',origin:`http://127.0.0.1:${ap}/`},{path:'/assets',origin:`http://127.0.0.1:${bp}/`}]}));
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AW_'))),
  PORT:'0',AW_SECRET:'long-testing-secret-1234567890',AW_DASHBOARD_TOKEN:'long-testing-admin-token-1234567890',
  AW_ORIGIN_URL:target,AW_PROXY_ENABLED:'true',AW_ROUTES_ENABLED:'true',
  AW_ROUTE_ALLOWED_ORIGINS:`http://127.0.0.1:${ap}/,http://127.0.0.1:${bp}/`,
  AW_SETUP_PUBLIC_HOST:'aw.example.com',AW_SETUP_CONFIG_ENABLED:'true',AW_SETUP_WRITES_ENABLED:'true',AW_SETUP_ALLOWED_ORIGINS:`http://127.0.0.1:${dp}/`,AW_SHADOW_MODE:'true',AW_AUDIT_ENABLED:'false',AW_BLACKHOLE_ENABLED:'false'};
 const server=http.createServer();const port=await listen(server);const closed=once(server,'close');server.close();await closed;env.PORT=String(port);
 const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
 child.errors='';child.stderr.on('data',chunk=>child.errors+=chunk.toString());t.after(async()=>{await stop(child);for(const s of [a,b,c,d]){s.closeAllConnections();s.close();}});
 const live=await waitLive(port,child);assert.equal(live.version,'2.4.0');assert.equal(live.routeCount,2);
 async function get(p,init){return fetch(`http://127.0.0.1:${port}${p}`,init);}
 assert.equal(await (await get('/api?x=1')).text(),'API GET /api?x=1');
 assert.equal(await (await get('/api/hello?x=1')).text(),'API GET /api/hello?x=1');
 assert.equal(await (await get('/assets/a.png')).text(),'STATIC GET /assets/a.png');
 assert.equal(await (await get('/apiary')).text(),'DEFAULT GET /apiary');
 assert.equal(await (await get('/other')).text(),'DEFAULT GET /other');
 const posted=await get('/api/submit',{method:'POST',body:'ok'});assert.equal(posted.status,200);
 assert.equal(await posted.text(),'API POST /api/submit');
 const readiness=await (await get('/ready')).json();assert.equal(readiness.ok,true);
 assert.deepEqual(readiness.origin.routes.map(r=>r.path).sort(),['/api','/assets']);
 assert.equal((await get('/api/%2fadmin')).status,400);
 assert.equal((await get('/anchor/api/stats')).status,401);
 const stats=await (await get('/anchor/api/stats',{headers:{authorization:'Bearer long-testing-admin-token-1234567890'}})).json();
 assert.equal(stats.routing.count,2);assert.deepEqual(stats.routing.routes.map(r=>r.path).sort(),['/api','/assets']);
 assert.doesNotMatch(JSON.stringify(stats.routing),new RegExp(String(ap)));
 const token='Bearer long-testing-admin-token-1234567890';
 const csrf=(await (await get('/anchor/api/session',{headers:{authorization:token}})).json()).csrfToken;
 const applied=await get('/anchor/api/setup/apply',{method:'POST',headers:{authorization:token,'x-aw-csrf':csrf,'content-type':'application/json'},body:JSON.stringify({proxyEnabled:true,originUrl:`http://127.0.0.1:${dp}/`})});
 assert.equal(applied.status,200);
 assert.equal(await (await get('/other')).text(),'CHANGED GET /other');
 assert.equal(await (await get('/api/again')).text(),'API GET /api/again');

});
test('proxy never treats leading // request target as a new upstream host',async t=>{
 let leaked=0;
 const evil=http.createServer((req,res)=>{leaked++;res.end('LEAK');});const ev=await listen(evil);
 const approved=http.createServer((req,res)=>res.end(`APPROVED ${req.url}`));const good=await listen(approved);
 const config={originUrl:`http://127.0.0.1:${good}/`,blackholeEnabled:false,proxyBodyMaxBytes:100000,
  proxyTimeoutMs:2000,trustProxy:false,publicScheme:'http',gatewayMaintenanceEnabled:false};
 const edge=http.createServer(createReverseProxy(config));const port=await listen(edge);
 t.after(()=>{for(const server of [evil,approved,edge]){server.closeAllConnections();server.close();}});
 const result=await new Promise((resolve,reject)=>{
  http.get({hostname:'127.0.0.1',port,path:`//127.0.0.1:${ev}/leak`},res=>{
    let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({body,status:res.statusCode}));
  }).on('error',reject);
 });
 assert.equal(result.status,200);assert.match(result.body,/^APPROVED /);assert.equal(leaked,0);
});
