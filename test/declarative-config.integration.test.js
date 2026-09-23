/** Full cPanel-style process test of YAML load, browser edits, routing and rollback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { serializeYaml } from '../src/declarative-config.js';

const app=fileURLToPath(new URL('../app.js',import.meta.url));
const page=fs.readFileSync(fileURLToPath(new URL('../public/setup.html',import.meta.url)),'utf8');
const secret='valid-dashboard-token-123456789';
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function freePort(){const server=net.createServer();const port=await listen(server);server.close();await once(server,'close');return port;}
async function waitLive(port,child){for(let i=0;i<90;i++){
  if(child.exitCode!==null)throw Error('Startup failed: '+child.stderrText);
  try{const r=await fetch(`http://127.0.0.1:${port}/live`);if(r.ok)return r.json();}catch{}
  await new Promise(resolve=>setTimeout(resolve,55));
}throw Error('No /live after timeout: '+child.stderrText);}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;
  const exited=once(child,'exit');child.kill('SIGTERM');const guard=setTimeout(()=>child.kill('SIGKILL'),1500);
  try{await exited;}finally{clearTimeout(guard);}}
function launch(cwd,port,env){
  const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AW_')));
  const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{
    cwd,env:{...clean,PORT:String(port),AW_SECRET:'a-persistent-test-secret-123456789',
      AW_DASHBOARD_TOKEN:secret,AW_SHADOW_MODE:'true',AW_BLACKHOLE_ENABLED:'false',
      AW_AUDIT_ENABLED:'false',...env},stdio:['ignore','pipe','pipe']});
  child.stderrText='';child.stderr.on('data',chunk=>child.stderrText+=chunk.toString());
  child.stdout.on('data',()=>{});return child;
}
async function api(port,endpoint,method='GET',body,csrf){
  const response=await fetch(`http://127.0.0.1:${port}/anchor/api/${endpoint}`,{
    method,headers:{authorization:`Bearer ${secret}`,'content-type':'application/json',...(csrf?{'x-aw-csrf':csrf}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=await response.json();return {status:response.status,body:json};
}
test('v2.1 setup page parses and has route editor and manual rollback',()=>{
  new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.match(page,/id="routeEditor"/);assert.match(page,/id="rollback"/);
  assert.doesNotMatch(page,/<script\s+src=/i);
});
test('YAML configuration: live route edits, approved-only API, persistence and rollback',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v21-integration-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  function server(label){return http.createServer((req,res)=>{res.setHeader('content-type','text/plain');res.end(`${label} ${req.method} ${req.url}`);});}
  const defaultSrv=server('DEFAULT'),apiSrv=server('API'),assetSrv=server('ASSETS');
  const d=await listen(defaultSrv),a=await listen(apiSrv),s=await listen(assetSrv);
  t.after(()=>{for(const srv of [defaultSrv,apiSrv,assetSrv]){srv.closeAllConnections();srv.close();}});
  const origin=`http://127.0.0.1:${d}/`,apiOrigin=`http://127.0.0.1:${a}/`,assetsOrigin=`http://127.0.0.1:${s}/`;
  fs.mkdirSync(path.join(dir,'data'));
  const filename=path.join(dir,'data','anchorweight-gateway.yaml');
  fs.writeFileSync(filename,serializeYaml({proxyEnabled:true,originUrl:origin,routes:[{path:'/api',origin:apiOrigin}]}),{mode:0o600});
  const env={AW_DECLARATIVE_ENABLED:'true',AW_DECLARATIVE_WRITES_ENABLED:'true',
    AW_DECLARATIVE_FILE:'./data/anchorweight-gateway.yaml',AW_PROXY_ENABLED:'false',
    AW_ORIGIN_URL:origin,AW_SETUP_ALLOWED_ORIGINS:origin,
    AW_ROUTE_ALLOWED_ORIGINS:`${apiOrigin},${assetsOrigin}`,AW_SETUP_PUBLIC_HOST:'aw.example.com'};
  const port=await freePort();let child=launch(dir,port,env);t.after(async()=>stop(child));
  let live=await waitLive(port,child);
  assert.equal(live.version,'2.3.0');assert.equal(live.proxyEnabled,true);assert.equal(live.routeCount,1);
  const get=p=>fetch(`http://127.0.0.1:${port}${p}`);
  assert.equal(await (await get('/api/hello?x=1')).text(),'API GET /api/hello?x=1');
  assert.equal(await (await get('/apiary')).text(),'DEFAULT GET /apiary');
  assert.equal((await get('/anchor/api/setup')).status,401);
  let snapshot=await api(port,'setup');assert.equal(snapshot.status,200);
  assert.equal(snapshot.body.declarativeEnabled,true);assert.equal(snapshot.body.writesEnabled,true);
  assert.equal(snapshot.body.settings.routes.length,1);
  const csrf=(await api(port,'session')).body.csrfToken;
  const next={proxyEnabled:true,originUrl:origin,routes:[{path:'/assets',origin:assetsOrigin}]};
  assert.equal((await api(port,'setup/apply','POST',next)).status,403,'CSRF is mandatory');
  assert.equal((await api(port,'setup/apply','POST',{...next,routes:[{path:'/live',origin:assetsOrigin}]},csrf)).status,400);
  assert.equal((await api(port,'setup/apply','POST',{...next,routes:[{path:'/assets',origin:'http://evil.example/'}]},csrf)).status,400);
  const validation=await api(port,'setup/validate','POST',next,csrf);
  assert.equal(validation.status,200);assert.equal(validation.body.originProbe.length,2);
  assert.ok(validation.body.originProbe.every(p=>p.healthy));
  const applied=await api(port,'setup/apply','POST',next,csrf);
  assert.equal(applied.status,200);assert.equal(applied.body.settings.routes[0].path,'/assets');
  assert.equal(applied.body.previousAvailable,true);
  assert.equal(await (await get('/assets/style.css?x=2')).text(),'ASSETS GET /assets/style.css?x=2');
  assert.equal(await (await get('/api/again')).text(),'DEFAULT GET /api/again');
  const status=(await api(port,'stats')).body;
  assert.deepEqual(status.routing.routes.map(r=>r.path),['/assets']);
  assert.equal((await get('/ready')).status,200);
  assert.equal(fs.statSync(filename).mode&0o777,0o600);
  assert.equal((await api(port,'setup/rollback','POST',{},csrf)).status,200);
  assert.equal(await (await get('/api/again')).text(),'API GET /api/again');
  assert.equal(await (await get('/assets/style.css')).text(),'DEFAULT GET /assets/style.css');
  await stop(child);
  child=launch(dir,port,env);live=await waitLive(port,child);
  assert.equal(live.routeCount,1,'rolled-back route persists on restart');
  assert.equal(await (await get('/api/restarted')).text(),'API GET /api/restarted');
});
test('declarative mode does not silently ignore missing configuration or allow legacy mix',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v21-missing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const port=await freePort();const child=launch(dir,port,{AW_DECLARATIVE_ENABLED:'true'});
  t.after(async()=>stop(child));
  await once(child,'exit');
  assert.match(child.stderrText,/ENOENT|startup failed/);
  const port2=await freePort();const mixed=launch(dir,port2,{AW_DECLARATIVE_ENABLED:'true',AW_ROUTES_ENABLED:'true'});
  t.after(async()=>stop(mixed));await once(mixed,'exit');
  assert.match(mixed.stderrText,/Invalid AnchorWeight configuration/);
});
