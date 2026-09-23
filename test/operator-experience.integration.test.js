import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const CLI=path.join(ROOT,'bin','operator.js');
const controlled={PATH:process.env.PATH||'', HOME:os.tmpdir(),
  AW_SECRET:'integration-test-persistent-secret-never-print',
  AW_DASHBOARD_TOKEN:'integration-test-dashboard-token-secret'};
const run=args=>execFileSync(process.execPath,[CLI,...args],{
  cwd:ROOT,encoding:'utf8',timeout:12000,env:controlled});

test('first-run CLI produces actionable plan and does not print secrets by default',()=>{
  const plan=run(['setup','--mode','proxy','--origin','http://127.0.0.1:8081/']);
  assert.match(plan,/AW_PROXY_ENABLED=true/);
  assert.match(plan,/AW_ORIGIN_URL=http:\/\/127\.0\.0\.1:8081\//);
  assert.doesNotMatch(plan,/integration-test-persistent-secret/);
  assert.match(run(['setup','--mode','trap']),/AW_PROXY_ENABLED=false/);
  assert.throws(()=>run(['setup','--mode','proxy','--origin','javascript:alert(1)']));
});

test('read-only CLI doctor JSON, gateway-only export, and help work from clean checkout',()=>{
  const result=JSON.parse(run(['doctor','--json']));
  assert.equal(result.ok,true);
  assert.ok(result.checks.some(x=>x.name==='Persisted state'));
  assert.equal(JSON.stringify(result).includes(controlled.AW_DASHBOARD_TOKEN),false);
  const exported=JSON.parse(run(['export','--format','json']));
  assert.equal(exported.version,1);
  assert.deepEqual(Object.keys(exported).sort(),['proxy','routes','version']);
  assert.match(run(['help']),/confirm-stopped/);
});

test('cPanel-compatible Node startup preserves live health, dashboard, wizard and trap without new config',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw26-live-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const reservation=net.createServer();
  reservation.listen(0,'127.0.0.1');
  await once(reservation,'listening');
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[path.join(ROOT,'app.js')],{
    cwd:dir,env:{...controlled,PORT:String(port),AW_PROXY_ENABLED:'false',
      AW_DECLARATIVE_ENABLED:'false',AW_APP_AUTH_ENABLED:'false',AW_ALERTS_ENABLED:'false',
      AW_ROUTES_ENABLED:'false',AW_RESILIENCE_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
  t.after(()=>child.kill('SIGTERM'));
  const url=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)break;
    try{const r=await fetch(url+'/live',{signal:AbortSignal.timeout(600)});
      if(r.ok){assert.equal((await r.json()).version,'2.6.0');ready=true;break;}}
    catch{}await new Promise(resolve=>setTimeout(resolve,80));
  }
  assert.equal(ready,true,logs);
  for(const p of ['/ready','/dashboard.html','/setup.html','/anchor/']){
    const r=await fetch(url+p);assert.equal(r.ok,true,`${p} HTTP ${r.status}`);
  }
  child.kill('SIGTERM');
  await once(child,'exit');
});
