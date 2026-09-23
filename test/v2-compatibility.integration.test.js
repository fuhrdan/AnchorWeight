import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const app=fileURLToPath(new URL('../app.js',import.meta.url));
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;s.close();await once(s,'close');return p;}
async function start(dir,p,backend){
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('AW_'))),
  PORT:String(p),AW_SECRET:'v2-persistent-testing-secret-123456',
  AW_DASHBOARD_TOKEN:'v2-dashboard-token-123456789000',AW_PROXY_ENABLED:'false',
  AW_SETUP_CONFIG_ENABLED:'true',AW_SETUP_WRITES_ENABLED:'false',AW_AUDIT_ENABLED:'false',
  AW_INTELLIGENCE_ENABLED:'false',AW_STATE_BACKEND:backend};
 const child=spawn(process.execPath,['-e',`require(${JSON.stringify(app)})`],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
 child.stderrText='';child.stderr.on('data',c=>child.stderrText+=c);child.stdout.resume();
 for(let n=0;n<100;n++){
   if(child.exitCode!==null)throw Error('startup failed: '+child.stderrText);
   try{const res=await fetch(`http://127.0.0.1:${p}/ready`);if(res.status===200)return child;}catch{}
   await new Promise(resolve=>setTimeout(resolve,40));
 }
 child.kill('SIGKILL');throw Error('startup timeout: '+child.stderrText);
}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');const timeout=setTimeout(()=>child.kill('SIGKILL'),2000);try{await exited;}finally{clearTimeout(timeout);}}
for(const backend of ['json','sqlite']){
 test(`v2 ${backend} cPanel-style startup and restart retain existing profile state and local admin access`,{
  skip:backend==='sqlite' && !process.versions.node.startsWith('22.') && Number(process.versions.node.split('.')[0])<23
 },async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),`aw-v2-${backend}-`));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const p=await port();let child=await start(dir,p,backend);t.after(async()=>stop(child));
  const base=`http://127.0.0.1:${p}`;
  const ready=await (await fetch(`${base}/ready`)).json();
  assert.equal(ready.version,'2.5.0');assert.equal(ready.stateBackend,backend);assert.equal(ready.stateVersion,5);
  const lure=await fetch(`${base}/anchor/`);assert.equal(lure.status,200);
  const token='Bearer v2-dashboard-token-123456789000';
  const stats=await (await fetch(`${base}/anchor/api/stats`,{headers:{authorization:token}})).json();
  assert.ok(stats.topProfiles.length>=1);
  const ids=stats.topProfiles.map(profile=>profile.botId||profile.id);
  await stop(child);child=await start(dir,p,backend);
  const again=await (await fetch(`${base}/anchor/api/stats`,{headers:{authorization:token}})).json();
  assert.ok(again.topProfiles.length>=1);
  assert.deepEqual(again.topProfiles.map(profile=>profile.botId||profile.id),ids);
  assert.equal((await fetch(`${base}/anchor/api/stats`)).status,401);
 });
}
