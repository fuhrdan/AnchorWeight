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
const app=fileURLToPath(new URL('../app.js',import.meta.url));
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const n=s.address().port;s.close();await once(s,'close');return n;}
async function start(options){
 const port=await freePort();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-gateway18-'));
 const base=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AW_')));
 const env={...base,PORT:String(port),AW_SECRET:'test-very-long-secret-for-gateway-18',AW_DASHBOARD_TOKEN:'long-dashboard-token-for-gateway-18',
  AW_AUDIT_ENABLED:'false',AW_BLACKHOLE_ENABLED:'false',AW_PROXY_ENABLED:'true',AW_ORIGIN_URL:options.origin,
  AW_SHADOW_MODE:'true',AW_SETUP_CONFIG_ENABLED:'false',...options.env};
 const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
 child.stderrText='';child.stderr.on('data',data=>child.stderrText+=data.toString());child.stdout.resume();
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error('startup failed: '+child.stderrText);
  try{const r=await fetch(`http://127.0.0.1:${port}/live`);if(r.ok)return {child,port,dir,env};}catch{}
  await new Promise(resolve=>setTimeout(resolve,75));
 }
 throw Error('timeout: '+child.stderrText);
}
async function stop(x){if(x.child.exitCode===null){const done=once(x.child,'exit');x.child.kill('SIGTERM');await done;}fs.rmSync(x.dir,{recursive:true,force:true});}
test('v1.8 cPanel require startup: proxy-only access rules, operator endpoints remain reachable',async()=>{
 const origin=http.createServer((_req,res)=>res.end('secret origin'));
 origin.listen(0,'127.0.0.1');await once(origin,'listening');
 const inst=await start({origin:`http://127.0.0.1:${origin.address().port}`,env:{AW_GATEWAY_ACCESS_ENABLED:'true',AW_GATEWAY_DENY_IPS:'127.0.0.0/8',AW_GATEWAY_SHADOW_MODE:'false'}});
 try{
  const denied=await fetch(`http://127.0.0.1:${inst.port}/private`);
  assert.equal(denied.status,403);assert.equal((await denied.json()).error,'ip_deny_rule');
  const admin=await fetch(`http://127.0.0.1:${inst.port}/anchor/api/stats`);
  assert.equal(admin.status,401);
  const stats=await fetch(`http://127.0.0.1:${inst.port}/anchor/api/stats`,{headers:{Authorization:'Bearer long-dashboard-token-for-gateway-18'}});
  const body=await stats.json();assert.equal(body.version,'1.8.0');assert.equal(body.gateway.denied,1);
  assert.equal(body.upstreamHealth.status,'disabled');
  const setup=await fetch(`http://127.0.0.1:${inst.port}/setup.html`);assert.equal(setup.status,200);
  const live=await fetch(`http://127.0.0.1:${inst.port}/live`);assert.equal(live.status,200);
 }finally{await stop(inst);origin.closeAllConnections();origin.close();}
});
test('rate limiting then upstream outage: GET 503 maintenance, POST 502 and normal upstream 5xx intact',async()=>{
 const origin=http.createServer((req,res)=>{res.statusCode=req.url==='/unhealthy'?503:200;res.end('ORIGIN');});
 origin.listen(0,'127.0.0.1');await once(origin,'listening');
 const inst=await start({origin:`http://127.0.0.1:${origin.address().port}`,env:{AW_GATEWAY_RATE_ENABLED:'true',AW_GATEWAY_SHADOW_MODE:'false',
  AW_GATEWAY_RATE_PER_MINUTE:'200',AW_GATEWAY_RATE_PATHS:'[{"path":"/limited","perMinute":2}]',AW_GATEWAY_HEALTH_ENABLED:'true',
  AW_GATEWAY_HEALTH_INTERVAL_MS:'5000',AW_GATEWAY_MAINTENANCE_ENABLED:'true'}});
 try{
  for(let i=0;i<2;i++)assert.equal((await fetch(`http://127.0.0.1:${inst.port}/limited`)).status,200);
  const throttled=await fetch(`http://127.0.0.1:${inst.port}/limited`);assert.equal(throttled.status,429);
  assert.ok(Number(throttled.headers.get('retry-after'))>0);
  const originError=await fetch(`http://127.0.0.1:${inst.port}/unhealthy`);
  assert.equal(originError.status,503);assert.equal(await originError.text(),'ORIGIN');
  origin.closeAllConnections();await new Promise(resolve=>origin.close(resolve));
  const maintenance=await fetch(`http://127.0.0.1:${inst.port}/some-page`);
  assert.equal(maintenance.status,503);assert.match(await maintenance.text(),/Service temporarily unavailable/);
  const post=await fetch(`http://127.0.0.1:${inst.port}/submit`,{method:'POST',body:'x'});
  assert.equal(post.status,502,'state-changing requests are never retried or converted into generic GET maintenance');
 }finally{await stop(inst);}
});
