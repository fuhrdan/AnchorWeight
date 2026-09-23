import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const app=fileURLToPath(new URL('../app.js',import.meta.url));
const page=fs.readFileSync(fileURLToPath(new URL('../public/setup.html',import.meta.url)),'utf8');
test('setup page browser script parses, includes controlled stages, and has no external JS',()=>{
  const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);new vm.Script(script);
  for(const label of ['Administrator connection','Choose an approved origin','Review and validate','Apply configuration'])
    assert.match(page,new RegExp(label));
  assert.doesNotMatch(page,/<script\s+src=/i);
});
async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;server.close();await once(server,'close');return port;}
async function online(port,child){for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error('AnchorWeight exited: '+child.stderrText);
  try{const r=await fetch(`http://127.0.0.1:${port}/live`);if(r.ok)return r.json();}catch{}
  await new Promise(resolve=>setTimeout(resolve,75));
}throw Error('AnchorWeight did not start: '+child.stderrText);}
function start({port,cwd,origin,viaRequire=false}){
  const base=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AW_')));
  const env={...base,PORT:String(port),AW_SECRET:'persistent-testing-secret-1234567890',
    AW_DASHBOARD_TOKEN:'dashboard-testing-token-1234567890',AW_ORIGIN_URL:origin,
    AW_PROXY_ENABLED:'false',AW_SHADOW_MODE:'true',AW_SETUP_CONFIG_ENABLED:'true',
    AW_SETUP_WRITES_ENABLED:'true',AW_BLACKHOLE_ENABLED:'false',AW_AUDIT_ENABLED:'false'};
  const args=viaRequire?['-e',`require(${JSON.stringify(app)})`]:[app];
  const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  child.stderrText='';child.stderr.on('data',data=>child.stderrText+=data.toString());child.stdout.on('data',()=>{});
  return child;
}
async function stop(child){
  if(child.exitCode!==null || child.signalCode!==null)return;
  const exited=once(child,'exit');
  child.kill('SIGTERM');
  const force=setTimeout(()=>child.kill('SIGKILL'),700);
  try{await exited;}finally{clearTimeout(force);}
}
async function api(port,path,token,method='GET',data=null,csrf=''){
  const r=await fetch(`http://127.0.0.1:${port}${path}`,{
    method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(csrf?{'X-AW-CSRF':csrf}:{})},
    ...(data===null?{}:{body:JSON.stringify(data)})
  });
  const body=await r.json();return {status:r.status,body};
}
test('real cPanel-style startup, authenticated wizard apply, proxied traffic, telemetry, and restart persistence',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-gateway-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const origin=http.createServer((req,res)=>{res.statusCode=req.url==='/missing'?404:200;res.end('ORIGIN '+req.url);});
  origin.listen(0,'127.0.0.1');await once(origin,'listening');
  t.after(()=>{origin.closeAllConnections();origin.close();});
  const target=`http://127.0.0.1:${origin.address().port}`;
  const port=await freePort();
  let child=start({port,cwd:dir,origin:target,viaRequire:true});
  t.after(async()=>{await stop(child);});
  let live=await online(port,child);
  assert.equal(live.version,'1.7.0');assert.equal(live.proxyEnabled,false);
  const pageResponse=await fetch(`http://127.0.0.1:${port}/setup.html`);
  assert.equal(pageResponse.status,200);assert.match(await pageResponse.text(),/AnchorWeight Setup/);
  const noAuth=await fetch(`http://127.0.0.1:${port}/anchor/api/setup`);
  assert.equal(noAuth.status,401);
  const token='dashboard-testing-token-1234567890';
  const config=(await api(port,'/anchor/api/setup',token)).body;
  assert.equal(config.writesEnabled,true);
  const csrf=(await api(port,'/anchor/api/session',token)).body.csrfToken;
  const settings={proxyEnabled:true,originUrl:target+'/'};
  const denied=await api(port,'/anchor/api/setup/apply',token,'POST',settings);
  assert.equal(denied.status,403);
  const validation=await api(port,'/anchor/api/setup/validate',token,'POST',settings,csrf);
  assert.equal(validation.status,200);assert.equal(validation.body.originProbe.healthy,true);
  const apply=await api(port,'/anchor/api/setup/apply',token,'POST',settings,csrf);
  assert.equal(apply.status,200);assert.equal(apply.body.settings.proxyEnabled,true);
  live=await (await fetch(`http://127.0.0.1:${port}/live`)).json();
  assert.equal(live.proxyEnabled,true);
  const proxied=await fetch(`http://127.0.0.1:${port}/hello`);
  assert.equal(proxied.status,200);assert.equal(await proxied.text(),'ORIGIN /hello');
  const notFound=await fetch(`http://127.0.0.1:${port}/missing`);
  assert.equal(notFound.status,404);
  const stats=await api(port,'/anchor/api/stats',token);
  assert.equal(stats.status,200);assert.ok(stats.body.telemetry.proxiedRequests>=2);
  assert.ok(stats.body.telemetry.statuses['4xx']>=1);
  assert.equal(stats.body.telemetry.dataScope,'in_memory_per_process');
  const file=path.join(dir,'data','anchorweight-operator.json');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  await stop(child);
  child=start({port,cwd:dir,origin:target});
  live=await online(port,child);
  assert.equal(live.proxyEnabled,true,'saved configuration loaded on restart');
  const after=await fetch(`http://127.0.0.1:${port}/again`);
  assert.equal(await after.text(),'ORIGIN /again');
  const newStats=(await api(port,'/anchor/api/stats',token)).body;
  assert.equal(newStats.telemetry.dataScope,'in_memory_per_process');
});
