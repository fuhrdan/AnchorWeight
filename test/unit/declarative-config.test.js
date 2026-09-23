import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { validateConfig } from '../../src/config-schema.js';
import { parseSimpleYaml, serializeYaml, validateDeclarative, parseDeclarative,
  readDeclarative, createDeclarativeController } from '../../src/declarative-config.js';

const base = () => loadConfig({
  setupBaselineOrigin:'http://127.0.0.1:8081/',
  setupAllowedOrigins:['http://127.0.0.1:8082/'],
  routeAllowedOrigins:['http://127.0.0.1:3001/','http://127.0.0.1:3002/'],
  setupPublicHost:'aw.example.com', declarativeEnabled:true,
  // Tests must represent a clean declarative setup regardless of the operator's
  // inherited cPanel environment. Legacy modes are tested explicitly below.
  routesEnabled:false, setupConfigEnabled:false, setupWritesEnabled:false,
  intelligenceEnabled:false, appAuthEnabled:false, trustedJa4Enabled:false,
  declarativeWritesEnabled:true, dashboardToken:'valid-test-dashboard-token',
  proxyEnabled:false, originUrl:'http://127.0.0.1:8081/', activeRoutes:[]
});
const doc = {
  version:1, proxy:{enabled:true,defaultOrigin:'http://127.0.0.1:8082/'},
  routes:[{path:'/api',origin:'http://127.0.0.1:3001/'},
    {path:'/assets',origin:'http://127.0.0.1:3002/'}]
};

test('JSON and YAML parse to the same approved gateway route settings',()=>{
  const config=base();
  const expected=validateDeclarative(config,doc);
  const yaml=serializeYaml({proxyEnabled:true,originUrl:doc.proxy.defaultOrigin,routes:doc.routes});
  assert.deepEqual(parseDeclarative(config,JSON.stringify(doc),'/tmp/gateway.json'),expected);
  assert.deepEqual(parseDeclarative(config,yaml,'/tmp/gateway.yaml'),expected);
  assert.equal(parseSimpleYaml(yaml).version,1);
});
test('restricted YAML rejects features that would change its meaning or require executing constructors',()=>{
  for(const bad of [
    'version: 1\nversion: 1',
    'version: !!js/function x',
    'version: &anchor 1',
    'version:\t1',
    'version: 1\n  invalid: value',
    'version: 1\nproxy:\n  enabled: false\n  enabled: true'
  ]) assert.throws(()=>parseSimpleYaml(bad));
});
test('unapproved, overlapping, reserved, and excessive routes are rejected',()=>{
  const config=base();
  for(const bad of [
    {...doc,proxy:{...doc.proxy,defaultOrigin:'http://evil.example/'}},
    {...doc,routes:[{path:'/api',origin:'http://evil.example/'}]},
    {...doc,routes:[{path:'/anchor',origin:'http://127.0.0.1:3001/'}]},
    {...doc,routes:[{path:'/api',origin:'http://127.0.0.1:3001/'},{path:'/api',origin:'http://127.0.0.1:3002/'}]},
    {...doc,routes:Array.from({length:17},(_,i)=>({path:`/path${i}`,origin:'http://127.0.0.1:3001/'}))},
    {...doc,routes:[{path:'/api/%2f',origin:'http://127.0.0.1:3001/'}]},
    {...doc,extra:'ignored'},
    {...doc,proxy:{enabled:'true',defaultOrigin:'http://127.0.0.1:8082/'}}
  ]) assert.throws(()=>validateDeclarative(config,bad));
});
test('enabling declarative configuration with legacy writable files is an explicit error',()=>{
  for(const overrides of [{routesEnabled:true},{setupConfigEnabled:true}]){
    const v=validateConfig({...base(),...overrides});
    assert.equal(v.valid,false);
    assert.match(v.errors.join(' '),/legacy/);
  }
});
test('file reader rejects oversized/symlink configs; disabled setting ignores the file',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-dcl-unit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'gateway.json'),symlink=path.join(dir,'alias.json');
  const config=base();
  fs.writeFileSync(file,JSON.stringify(doc));
  assert.equal(readDeclarative(config,file).routes.length,2);
  assert.equal(readDeclarative({...config,declarativeEnabled:false},file),null);
  fs.symlinkSync(file,symlink);
  if(fs.constants.O_NOFOLLOW)assert.throws(()=>readDeclarative(config,symlink));
  fs.writeFileSync(file,' '.repeat(33000));
  assert.throws(()=>readDeclarative(config,file),/config_too_large/);
});
test('wizard cannot write without explicit opt-in or an approved origin',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-dcl-controller-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'data','config.json');
  const config=base();
  const controller=createDeclarativeController({...config,declarativeWritesEnabled:false},{file});
  const settings={proxyEnabled:true,originUrl:'http://127.0.0.1:8082/',routes:[]};
  assert.throws(()=>controller.apply(settings),/setup_write_disabled/);
  assert.equal(fs.existsSync(file),false);
  assert.throws(()=>controller.validate({...settings,originUrl:'http://unsafe.example/'}),/origin_not_approved/);
});
test('wizard saves validated JSON with private permissions, previous version, and prepared activation',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-dcl-controller-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'data','gateway.json');
  const config=base();
  let activated=0;
  const controller=createDeclarativeController(config,{file,onActivate:settings=>()=>{
    config.proxyEnabled=settings.proxyEnabled;config.originUrl=settings.originUrl;config.activeRoutes=settings.routes;activated++;
  }});
  const first={proxyEnabled:true,originUrl:'http://127.0.0.1:8081/',routes:[{path:'/api',origin:'http://127.0.0.1:3001/'}]};
  controller.apply(first);
  assert.equal(activated,1);assert.equal(fs.statSync(file).mode&0o777,0o600);
  const second={proxyEnabled:false,originUrl:'http://127.0.0.1:8082/',routes:[]};
  controller.apply(second);
  assert.equal(activated,2);assert.equal(readDeclarative(config,file).proxyEnabled,false);
  assert.equal(readDeclarative(config,file+'.previous').proxyEnabled,true);
  const before=fs.readFileSync(file,'utf8');
  const fails=createDeclarativeController(config,{file,onActivate:()=>{throw Error('prepare_failed');}});
  assert.throws(()=>fails.apply(first),/prepare_failed/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
});
