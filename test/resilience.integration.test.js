/** Real Passenger-style startup, proxy routing, circuit breaking, and private fallback. */
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
const app=fileURLToPath(new URL('../app.js',import.meta.url));
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function unusedPort(){const s=net.createServer();const p=await listen(s);s.close();await once(s,'close');return p;}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;
 const exited=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);
 try{await exited;}finally{clearTimeout(timer);}}

test('cPanel-style startup: independent circuit, approved fallback, no POST reroute, local operator endpoints',async t=>{
 const primary=http.createServer((req,res)=>{res.statusCode=503;res.end('PRIMARY ERROR');});
 let fallbackCredentials;
 const fallback=http.createServer((req,res)=>{
  fallbackCredentials={authorization:req.headers.authorization,key:req.headers['x-api-key']};
  res.end('FALLBACK '+req.method+' '+req.url);
 });
 const p1=await listen(primary),p2=await listen(fallback);
 t.after(()=>{primary.closeAllConnections();fallback.closeAllConnections();primary.close();fallback.close();});
 const origin=`http://127.0.0.1:${p1}/`,alternate=`http://127.0.0.1:${p2}/`;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v23-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 fs.mkdirSync(path.join(dir,'data'));
 fs.writeFileSync(path.join(dir,'data','fallbacks.json'),JSON.stringify({version:1,fallbacks:[{origin,fallback:alternate}]}),{mode:0o600});
 const port=await unusedPort();
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AW_'))),
  PORT:String(port),AW_SECRET:'resilience-test-long-persistent-secret',AW_DASHBOARD_TOKEN:'resilience-test-long-dashboard-token',
  AW_PROXY_ENABLED:'true',AW_ORIGIN_URL:origin,AW_BLACKHOLE_ENABLED:'false',AW_AUDIT_ENABLED:'false',
  AW_RESILIENCE_ENABLED:'true',AW_RESILIENCE_FAILURE_THRESHOLD:'2',AW_RESILIENCE_COOLDOWN_MS:'300000',
  AW_RESILIENCE_FALLBACKS_FILE:'./data/fallbacks.json',AW_RESILIENCE_ALLOWED_ORIGINS:alternate,
  AW_SETUP_PUBLIC_HOST:'aw.example.test'};
 const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
 t.after(async()=>stop(child));child.stdout.resume();let errors='';child.stderr.on('data',x=>errors+=x);
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw Error('startup failed '+errors);
  try{if((await fetch(base+'/live')).ok)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,60));
 }
 assert.equal((await (await fetch(base+'/live')).json()).version,'2.6.0');
 for(let i=0;i<2;i++){
  const r=await fetch(base+'/api/item?x=1');
  assert.equal(r.status,503,'upstream 5xx is passed through, never replayed');
  assert.equal(await r.text(),'PRIMARY ERROR');
 }
 const switched=await fetch(base+'/api/item?x=1',{headers:{authorization:'Bearer private-secret','x-api-key':'private-key'}});
 assert.equal(switched.status,200);assert.equal(await switched.text(),'FALLBACK GET /api/item?x=1');
 assert.deepEqual(fallbackCredentials,{authorization:undefined,key:undefined},'do not leak credentials to alternate origin');
 assert.equal((await fetch(base+'/api/item',{method:'POST',body:'PAYMENT'})).status,503);
 const stats=await fetch(base+'/anchor/api/stats',{headers:{authorization:'Bearer resilience-test-long-dashboard-token'}});
 assert.equal(stats.status,200);const view=await stats.json();
 assert.equal(view.resilience.enabled,true);assert.equal(view.resilience.fallbackSelections,1);
 assert.ok(!JSON.stringify(view.resilience).includes('127.0.0.1'));
 assert.equal((await fetch(base+'/setup.html')).status,200);
 assert.equal((await fetch(base+'/anchor/api/stats')).status,401);
});

test('enabled fallback configuration refuses unknown destination before public listener opens',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v23-invalid-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 fs.mkdirSync(path.join(dir,'data'));
 fs.writeFileSync(path.join(dir,'data','fallbacks.json'),JSON.stringify({version:1,fallbacks:[{origin:'http://127.0.0.1:8101/',fallback:'http://unapproved.test/'}]}),{mode:0o600});
 const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,stdio:['ignore','pipe','pipe'],
  env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AW_'))),
   PORT:String(await unusedPort()),AW_RESILIENCE_ENABLED:'true',AW_PROXY_ENABLED:'true',
   AW_ORIGIN_URL:'http://127.0.0.1:8101/',AW_RESILIENCE_ALLOWED_ORIGINS:'http://127.0.0.1:8102/',
   AW_RESILIENCE_FALLBACKS_FILE:'./data/fallbacks.json',AW_BLACKHOLE_ENABLED:'false'}});
 let errors='';child.stderr.on('data',x=>errors+=x);child.stdout.resume();t.after(async()=>stop(child));
 await once(child,'exit');assert.match(errors,/fallback_not_approved/);
});
