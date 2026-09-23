/** End-to-end proof that site authentication cannot capture admin or trap URLs. */
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
import { makeBasicCredential, makeApiCredential } from '../src/app-auth.js';
const app=fileURLToPath(new URL('../app.js',import.meta.url));
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function port(){const s=net.createServer();const p=await listen(s);s.close();await once(s,'close');return p;}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const exit=once(child,'exit');child.kill('SIGTERM');const guard=setTimeout(()=>child.kill('SIGKILL'),1500);try{await exit;}finally{clearTimeout(guard);}}
test('application Basic Auth and API keys protect only configured proxy paths; origin never sees credentials',async t=>{
  const seen=[];
  const origin=http.createServer((req,res)=>{seen.push({path:req.url,authorization:req.headers.authorization,key:req.headers['x-api-key']});res.end('ORIGIN '+req.url);});
  const upstream=await listen(origin);t.after(()=>{origin.closeAllConnections();origin.close();});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v22-auth-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'data'));
  const key=makeApiCredential('test');
  fs.writeFileSync(path.join(dir,'data','anchorweight-app-auth.json'),JSON.stringify({version:1,policies:[
    {path:'/private',mode:'basic',credentials:[makeBasicCredential('alice','this-is-a-strong-test-password')]},
    {path:'/api/private',mode:'api_key',credentials:[key.credential]}
  ]}),{mode:0o600});
  const p=await port();
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AW_'))),PORT:String(p),
    AW_SECRET:'very-long-auth-test-secret',AW_DASHBOARD_TOKEN:'very-long-auth-dashboard-token',
    AW_PROXY_ENABLED:'true',AW_ORIGIN_URL:`http://127.0.0.1:${upstream}/`,AW_SHADOW_MODE:'true',
    AW_BLACKHOLE_ENABLED:'false',AW_AUDIT_ENABLED:'false',AW_APP_AUTH_ENABLED:'true',AW_PUBLIC_SCHEME:'https'};
  const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
  t.after(async()=>stop(child));let errors='';child.stderr.on('data',d=>errors+=d);child.stdout.resume();
  const base=`http://127.0.0.1:${p}`;
  for(let i=0;i<90;i++){
    if(child.exitCode!==null)throw Error(errors);
    try{if((await fetch(base+'/live')).ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,60));
  }
  assert.equal((await (await fetch(base+'/live')).json()).version,'2.2.0');
  const blocked=await fetch(base+'/private/file');
  assert.equal(blocked.status,401);assert.match(blocked.headers.get('www-authenticate'),/^Basic /);
  assert.equal((await fetch(base+'/private/file',{headers:{authorization:'Basic '+Buffer.from('alice:wrong-password').toString('base64')}})).status,401);
  const ok=await fetch(base+'/private/file?x=1',{headers:{authorization:'Basic '+Buffer.from('alice:this-is-a-strong-test-password').toString('base64')}});
  assert.equal(ok.status,200);assert.equal(await ok.text(),'ORIGIN /private/file?x=1');
  assert.equal((await fetch(base+'/api/private')).status,401);
  assert.equal((await fetch(base+'/api/private',{headers:{'x-api-key':key.key}})).status,200);
  assert.equal((await fetch(base+'/api/private',{headers:{'x-api-key':key.key,authorization:'Bearer fake'}})).status,401);
  assert.equal((await fetch(base+'/api/public')).status,200);
  // Reject encoded path separators: an upstream might decode what the gateway did not.
  assert.equal((await fetch(base+'/private%2ffile')).status,400);
  assert.equal((await fetch(base+'/private%5cfile')).status,400);
  assert.equal((await fetch(base+'/privateish')).status,200);
  assert.equal((await fetch(base+'/anchor/api/stats')).status,401,'app credentials do not authenticate dashboard');
  assert.equal((await fetch(base+'/anchor/api/stats',{headers:{authorization:'Bearer very-long-auth-dashboard-token'}})).status,200);
  assert.equal((await fetch(base+'/setup.html')).status,200);
  assert.equal((await fetch(base+'/ready')).status,200);
  assert.ok(seen.every(x=>x.authorization===undefined && x.key===undefined));
  assert.ok(seen.length>=4);
});
test('enabled authentication with missing policy file fails startup rather than exposing the site',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-v22-missing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,
    env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AW_'))),
      AW_APP_AUTH_ENABLED:'true',AW_PUBLIC_SCHEME:'https',AW_BLACKHOLE_ENABLED:'false',PORT:String(await port())},
    stdio:['ignore','pipe','pipe']});
  t.after(async()=>stop(child));let errors='';child.stderr.on('data',d=>errors+=d);child.stdout.resume();
  await once(child,'exit');assert.match(errors,/ENOENT|auth_file/i);
});
