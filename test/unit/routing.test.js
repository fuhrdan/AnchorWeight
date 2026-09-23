import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadRoutes,validateRouteDocument,routeForPath,unsafeRoutePath,normalizeRouteOrigin} from '../../src/routing.js';
const config={basePath:'/anchor',routesEnabled:true,setupPublicHost:'aw.example.com',
  routeAllowedOrigins:['http://127.0.0.1:3001/','http://127.0.0.1:3002/']};
const document={version:1,routes:[{path:'/api',origin:'http://127.0.0.1:3001/'},
  {path:'/api/private',origin:'http://127.0.0.1:3002/'},{path:'/assets',origin:'http://127.0.0.1:3002/'}]};
test('longest segment prefix, no partial matches and default route',()=>{
  const routes=validateRouteDocument(document,config);
  assert.equal(routeForPath(routes,'/api/private/a').origin,'http://127.0.0.1:3002/');
  assert.equal(routeForPath(routes,'/api').origin,'http://127.0.0.1:3001/');
  assert.equal(routeForPath(routes,'/api/hello').origin,'http://127.0.0.1:3001/');
  assert.equal(routeForPath(routes,'/apiculture'),null);
  assert.equal(routeForPath(routes,'/'),null);
});
test('rejects protected endpoints, self routing, unapproved origins, duplicates and malformed URLs',()=>{
  for(const p of ['/','/anchor','/anchor/api','/ready','/dashboard.html','/setup.html','/live','/health'])
    assert.throws(()=>validateRouteDocument({version:1,routes:[{path:p,origin:'http://127.0.0.1:3001/'}]},config));
  for(const origin of ['http://aw.example.com/','http://evil.example/','http://127.0.0.1:3001@evil.example/','file:///etc/passwd','http://127.0.0.1:3001/x'])
    assert.throws(()=>validateRouteDocument({version:1,routes:[{path:'/api',origin}]},config));
  assert.throws(()=>validateRouteDocument({version:1,routes:[document.routes[0],document.routes[0]]},config));
  assert.throws(()=>validateRouteDocument({version:1,routes:[{path:'/api//x',origin:'http://127.0.0.1:3001/'}]},config));
  assert.throws(()=>validateRouteDocument({version:1,routes:[]},config));
  assert.throws(()=>normalizeRouteOrigin('http://127.0.0.1:3001/?q=1'));
});
test('route file is ignored when disabled, rejects oversize, symlink and unapproved destination',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-routes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'routes.json');
  assert.deepEqual(loadRoutes({...config,routesEnabled:false,routesFile:file}),[]);
  fs.writeFileSync(file,JSON.stringify(document));
  assert.equal(loadRoutes({...config,routesFile:file}).length,3);
  fs.writeFileSync(file,'x'.repeat(33000));
  assert.throws(()=>loadRoutes({...config,routesFile:file}));
  fs.writeFileSync(file,JSON.stringify(document));
  const link=path.join(dir,'link.json');fs.symlinkSync(file,link);
  assert.throws(()=>loadRoutes({...config,routesFile:link}));
  assert.throws(()=>loadRoutes({...config,routesFile:file,routeAllowedOrigins:[]}));
});
test('ambiguous encoded slash/dot and backslash are rejected',()=>{
  for(const p of ['//other/x','/api/%2Fsecret','/api/%2e%2e/private','/api/%5cadmin','/api/\\a'])
    assert.equal(unsafeRoutePath(p),true);
  assert.equal(unsafeRoutePath('/api/ordinary'),false);
});
