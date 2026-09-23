import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.js';
import { diagnose, exportGateway } from '../../src/operator-experience.js';

const base = () => loadConfig({
  setupBaselineOrigin:'http://127.0.0.1:8081/',originUrl:'http://127.0.0.1:8081/',
  routeAllowedOrigins:['http://127.0.0.1:3001/'],setupPublicHost:'aw.test.example',
  proxyEnabled:false,routesEnabled:false,setupConfigEnabled:false,setupWritesEnabled:false,
  declarativeEnabled:false,declarativeWritesEnabled:false,appAuthEnabled:false,
  alertsEnabled:false,intelligenceEnabled:false,trustedJa4Enabled:false,
  resilienceEnabled:false,gatewayRateEnabled:false,gatewayAccessEnabled:false,
  dashboardToken:'test-token-with-sufficient-length',stateBackend:'json'
});
const moduleUrl = new URL('../../src/operator-experience.js',import.meta.url).href;
const configUrl = new URL('../../src/config.js',import.meta.url).href;
const declarativeUrl = new URL('../../src/declarative-config.js',import.meta.url).href;

function isolated(t, code) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'aw-operator-test-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{
    cwd:folder,encoding:'utf8',timeout:12000,
    // No inherited cPanel production policy may alter this unit fixture.
    env:{PATH:process.env.PATH||'',HOME:folder,TMPDIR:os.tmpdir()}
  });
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  return {folder,result};
}

test('gateway-only export is deterministic and never contains dashboard secrets',()=>{
  const config=base();
  const j=JSON.parse(exportGateway(config));
  assert.deepEqual(Object.keys(j).sort(),['proxy','routes','version']);
  assert.equal(j.proxy.defaultOrigin,'http://127.0.0.1:8081/');
  assert.equal(j.routes.length,0);
  assert.equal(exportGateway(config).includes(config.dashboardToken),false);
  assert.match(exportGateway(config,'yaml'),/version: 1/);
  assert.throws(()=>exportGateway(config,'html'),/unsupported_export_format/);
});

test('installation doctor is read-only and distinguishes warnings, skipped checks and failures',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'aw-doctor-unit-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const config={...base(),stateFile:path.join(folder,'missing','state.json'),
    logFile:path.join(folder,'missing','events.jsonl'),
    auditLogFile:path.join(folder,'missing','audit.jsonl')};
  const report=await diagnose(config,{env:{AW_SECRET:'persistent-test'},nodeVersion:'22.16.0'});
  assert.equal(report.ok,true);
  assert.ok(report.checks.some(c=>c.name==='State directory'&&c.status==='WARN'));
  assert.ok(report.checks.some(c=>c.name==='Origin reachability'&&c.status==='SKIP'));
  assert.equal(fs.existsSync(path.join(folder,'missing')),false,'doctor must not create missing directories');
  const bad=await diagnose({...config,appAuthEnabled:true,appAuthFile:path.join(folder,'missing.json')},
    {env:{AW_SECRET:'persistent-test'}});
  assert.equal(bad.ok,false);
  assert.ok(bad.checks.some(c=>c.name==='Application authentication'&&c.status==='FAIL'));
});

test('import validates by default, applies with stopped confirmation, retains previous and rolls back',t=>{
  const script=`import fs from 'node:fs';
    import assert from 'node:assert/strict';
    import {loadConfig} from ${JSON.stringify(configUrl)};
    import {importGateway,readSmallFile} from ${JSON.stringify(moduleUrl)};
    import {readDeclarative} from ${JSON.stringify(declarativeUrl)};
    fs.mkdirSync('data',{mode:0o700});
    const config=loadConfig({declarativeEnabled:true,declarativeWritesEnabled:false,
      setupConfigEnabled:false,setupWritesEnabled:false,routesEnabled:false,
      appAuthEnabled:false,alertsEnabled:false,intelligenceEnabled:false,
      resilienceEnabled:false,trustedJa4Enabled:false,
      setupBaselineOrigin:'http://127.0.0.1:8081/',
      setupAllowedOrigins:['http://127.0.0.1:8082/'],
      routeAllowedOrigins:['http://127.0.0.1:3001/'],setupPublicHost:'aw.test.example',
      dashboardToken:'unit-test-dashboard-token',proxyEnabled:false,
      originUrl:'http://127.0.0.1:8081/'});
    const one={version:1,proxy:{enabled:false,defaultOrigin:'http://127.0.0.1:8081/'},routes:[]};
    const two={version:1,proxy:{enabled:true,defaultOrigin:'http://127.0.0.1:8082/'},
      routes:[{path:'/api',origin:'http://127.0.0.1:3001/'}]};
    fs.writeFileSync('data/first.json',JSON.stringify(one),{mode:0o600});
    fs.writeFileSync('data/second.json',JSON.stringify(two),{mode:0o600});
    assert.equal(importGateway(config,'data/first.json').applied,false);
    assert.equal(fs.existsSync('data/anchorweight-gateway.json'),false);
    assert.throws(()=>importGateway(config,'data/first.json',{apply:true}),/confirm_stopped/);
    const a=importGateway(config,'data/first.json',{apply:true,confirmStopped:true});
    assert.equal(a.restartRequired,true);
    assert.equal(fs.statSync('data/anchorweight-gateway.json').mode&0o777,0o600);
    importGateway(config,'data/second.json',{apply:true,confirmStopped:true});
    assert.equal(readDeclarative(config).routes.length,1);
    assert.equal(fs.existsSync('data/anchorweight-gateway.json.previous'),true);
    importGateway(config,null,{apply:true,confirmStopped:true,rollback:true});
    assert.equal(readDeclarative(config).proxyEnabled,false);
    assert.equal(readDeclarative(config).routes.length,0);
    fs.writeFileSync('data/unapproved.json',JSON.stringify({...two,proxy:{enabled:true,defaultOrigin:'https://evil.example/'}}));
    assert.throws(()=>importGateway(config,'data/unapproved.json',{apply:true,confirmStopped:true}),/origin_not_approved/);
    assert.equal(readDeclarative(config).proxyEnabled,false);
    fs.symlinkSync('data/first.json','linked.json');
    if(fs.constants.O_NOFOLLOW)assert.throws(()=>readSmallFile('linked.json'));
    fs.writeFileSync('huge.json',' '.repeat(32769));
    assert.throws(()=>readSmallFile('huge.json'),/invalid_import_size_or_type/);
    console.log('isolated gateway import and rollback PASS');`;
  const {result}=isolated(t,script);
  assert.match(result.stdout,/import and rollback PASS/);
});

test('enabled mode required for applying imports, and legacy mode cannot be mixed',t=>{
  const script=`import fs from 'node:fs';import assert from 'node:assert/strict';
    import {loadConfig} from ${JSON.stringify(configUrl)};
    import {importGateway} from ${JSON.stringify(moduleUrl)};
    fs.mkdirSync('data',{mode:0o700});
    fs.writeFileSync('gateway.json',JSON.stringify({version:1,proxy:{enabled:false,
      defaultOrigin:'http://127.0.0.1:8081/'},routes:[]}));
    const c=loadConfig({declarativeEnabled:false,routesEnabled:false,setupConfigEnabled:false,
      setupWritesEnabled:false,appAuthEnabled:false,alertsEnabled:false,intelligenceEnabled:false,
      resilienceEnabled:false,trustedJa4Enabled:false,setupPublicHost:'aw.test.example'});
    assert.throws(()=>importGateway(c,'gateway.json',{apply:true,confirmStopped:true}),/enable_declarative/);
    assert.throws(()=>importGateway({...c,declarativeEnabled:true,routesEnabled:true},
      'gateway.json',{apply:true,confirmStopped:true}),/legacy_route/);`;
  isolated(t,script);
});
