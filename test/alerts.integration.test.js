/** Genuine cPanel/Passenger-style startup with private alerts and public routing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const app=fileURLToPath(new URL('../app.js',import.meta.url));
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function freePort(){const server=net.createServer();const port=await listen(server);server.close();await once(server,'close');return port;}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);try{await done;}finally{clearTimeout(timer);}}
const policy={version:1,webhooks:[{id:'ops',url:'https://alerts.example.com/hooks/aw'}],rules:[
  {id:'only_transition',kind:'circuit_open',route:'/',threshold:1,cooldownSeconds:60,webhook:'ops'}]};
test('real Node startup: alerts stay private, authenticated snapshots work, normal requests unaffected',async t=>{
 const origin=http.createServer((_req,res)=>res.end('ORIGIN OK'));const upstream=await listen(origin);
 t.after(()=>{origin.closeAllConnections();origin.close();});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw25-alerts-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','alerts.json'),JSON.stringify(policy),{mode:0o600});
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AW_'))),
  PORT:String(port),AW_SECRET:'integration-sufficiently-long-secret',AW_DASHBOARD_TOKEN:'integration-sufficiently-long-dashboard-token',
  AW_PROXY_ENABLED:'true',AW_ORIGIN_URL:`http://127.0.0.1:${upstream}/`,AW_BLACKHOLE_ENABLED:'false',AW_AUDIT_ENABLED:'false',
  AW_ALERTS_ENABLED:'true',AW_ALERTS_FILE:'./data/alerts.json',AW_ALERT_ALLOWED_HOSTS:'alerts.example.com',
  AW_ALERT_SIGNING_KEY:'v2.5-alerts-dedicated-integration-signing-secret'};
 const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
 t.after(()=>stop(child));child.stdout.resume();let errors='';child.stderr.on('data',x=>errors+=x);
 for(let i=0;i<90;i++){if(child.exitCode!==null)throw Error('startup failed '+errors);
   try{if((await fetch(base+'/live')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
 assert.equal((await (await fetch(base+'/live')).json()).version,'2.5.0');
 assert.equal(await (await fetch(base+'/hello')).text(),'ORIGIN OK');
 assert.equal((await fetch(base+'/anchor/api/stats')).status,401);
 const authorized=await fetch(base+'/anchor/api/stats',{headers:{authorization:'Bearer integration-sufficiently-long-dashboard-token'}});
 assert.equal(authorized.status,200);const json=await authorized.json();
 assert.equal(json.alerts.enabled,true);assert.equal(json.alerts.ruleCount,1);assert.equal(json.alerts.webhookCount,1);
 assert.doesNotMatch(JSON.stringify(json.alerts),/alerts\.example\.com|signing-secret|http:\/\/127\.0\.0\.1/);
});
test('enabled invalid alerts file prevents startup; disabled mode ignores missing file',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw25-invalid-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'data'));
 const baseEnv={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AW_'))),
   PORT:String(await freePort()),AW_SECRET:'integration-sufficiently-long-secret',
   AW_ALERTS_FILE:'./data/missing.json',AW_ALERT_ALLOWED_HOSTS:'alerts.example.com',
   AW_ALERT_SIGNING_KEY:'v2.5-alerts-dedicated-integration-signing-secret'};
 const bad=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,
   env:{...baseEnv,AW_ALERTS_ENABLED:'true'},stdio:['ignore','pipe','pipe']});
 let errors='';bad.stderr.on('data',x=>errors+=x);bad.stdout.resume();t.after(()=>stop(bad));
 await once(bad,'exit');assert.match(errors,/ENOENT|no such file/);
 const port=await freePort(),good=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,
   env:{...baseEnv,PORT:String(port),AW_ALERTS_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 t.after(()=>stop(good));good.stdout.resume();let goodErr='';good.stderr.on('data',x=>goodErr+=x);
 for(let i=0;i<90;i++){if(good.exitCode!==null)throw Error('disabled startup failed '+goodErr);
  try{if((await fetch(`http://127.0.0.1:${port}/live`)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
 assert.equal((await(await fetch(`http://127.0.0.1:${port}/live`)).json()).version,'2.5.0');
});
