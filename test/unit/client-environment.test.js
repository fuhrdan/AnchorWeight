import test from 'node:test';
import assert from 'node:assert/strict';
import { assessClientEnvironment, injectClientEnvironmentCollector } from '../../src/client-environment.js';

test('normal display is not scored as suspicious',()=>{
  const a=assessClientEnvironment({
    screenAvailable:true,screenWidth:1920,screenHeight:1080,availWidth:1920,availHeight:1040,
    viewportWidth:1536,viewportHeight:730,devicePixelRatio:1.25,colorDepth:24,orientation:'landscape-primary'
  },{secret:'test'});
  assert.equal(a.points,0);
  assert.equal(a.fingerprint.length,16);
});

test('impossible display relationships are explainably scored',()=>{
  const a=assessClientEnvironment({
    screenAvailable:true,screenWidth:800,screenHeight:600,availWidth:1200,availHeight:700,
    viewportWidth:2000,viewportHeight:1000,devicePixelRatio:0,colorDepth:24,orientation:'portrait-primary'
  },{secret:'test'});
  assert.ok(a.points >= 40);
  assert.ok(a.reasons.some(x=>x.reason==='available_area_exceeds_screen'));
  assert.ok(a.reasons.some(x=>x.reason==='viewport_materially_exceeds_screen'));
  assert.ok(a.reasons.some(x=>x.reason==='device_pixel_ratio_invalid'));
});

test('missing screen is a signal, never proof by itself',()=>{
  const a=assessClientEnvironment({screenAvailable:false,viewportWidth:1024,viewportHeight:768},{secret:'test'});
  assert.equal(a.points,12);
});

test('collector injection is idempotent',()=>{
  const once=injectClientEnvironmentCollector('<html><body>Hello</body></html>','/anchor');
  const twice=injectClientEnvironmentCollector(once,'/anchor');
  assert.match(once,/client-environment/);
  assert.equal(once,twice);
});
