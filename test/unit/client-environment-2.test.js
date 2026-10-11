import test from 'node:test';
import assert from 'node:assert/strict';
import { assessClientEnvironment, normalizeClientEnvironment, clientEnvironmentCollector } from '../../src/client-environment.js';

test('Client Environment 2.0 records webdriver without changing legacy geometry points',()=>{
  const a=assessClientEnvironment({
    screenAvailable:true,screenWidth:1920,screenHeight:1080,availWidth:1920,availHeight:1040,
    viewportWidth:1500,viewportHeight:800,devicePixelRatio:1,colorDepth:24,orientation:'landscape-primary',
    webdriver:true,screenExtendedAvailable:true,screenExtended:false,windowManagementApiAvailable:true,
    hardwareConcurrency:8,maxTouchPoints:0
  },{secret:'test'});
  assert.equal(a.points,0);
  assert.equal(a.headlessConsistency.automationControlled,true);
  assert.ok(a.headlessConsistency.indicators.some(x=>x.reason==='webdriver_automation_controlled'));
});

test('extended display is descriptive and not suspicious by itself',()=>{
  const a=assessClientEnvironment({
    screenAvailable:true,screenWidth:2560,screenHeight:1440,availWidth:2560,availHeight:1400,
    viewportWidth:1600,viewportHeight:900,devicePixelRatio:1,colorDepth:24,orientation:'landscape-primary',
    webdriver:false,screenExtendedAvailable:true,screenExtended:true
  },{secret:'test'});
  assert.equal(a.points,0);
  assert.equal(a.headlessConsistency.multiScreenState,'extended');
  assert.equal(a.headlessConsistency.indicators.length,0);
});

test('unsupported extended-screen API remains unavailable rather than pretending one monitor',()=>{
  const e=normalizeClientEnvironment({screenAvailable:true,screenWidth:1280,screenHeight:720});
  const a=assessClientEnvironment(e,{secret:'test'});
  assert.equal(a.headlessConsistency.multiScreenState,'unavailable');
  assert.equal(a.headlessConsistency.capabilities.exactScreenCountCollected,false);
});

test('screen API absence is supporting evidence but not headless proof',()=>{
  const a=assessClientEnvironment({screenAvailable:false,viewportWidth:1024,viewportHeight:768,webdriver:false},{secret:'test'});
  assert.equal(a.headlessConsistency.automationControlled,false);
  assert.ok(a.headlessConsistency.indicators.some(x=>x.reason==='screen_api_unavailable'));
  assert.ok(a.headlessConsistency.indicators.some(x=>x.reason==='viewport_without_screen_api'));
});

test('collector observes webdriver and screen.isExtended without requesting screen-details permission',()=>{
  const script=clientEnvironmentCollector('/anchor');
  assert.match(script,/n\.webdriver/);
  assert.match(script,/s\.isExtended/);
  assert.match(script,/typeof window\.getScreenDetails/);
  assert.doesNotMatch(script,/getScreenDetails\s*\(\s*\)/);
});

test('hardware and touch values are bounded before storage',()=>{
  const e=normalizeClientEnvironment({hardwareConcurrency:99999,maxTouchPoints:999});
  assert.equal(e.hardwareConcurrency,null);
  assert.equal(e.maxTouchPoints,null);
});

test('headless consistency never claims exact physical monitor count',()=>{
  const a=assessClientEnvironment({screenExtendedAvailable:true,screenExtended:true},{secret:'test'});
  assert.equal(a.headlessConsistency.capabilities.exactScreenCountCollected,false);
  assert.equal(a.headlessConsistency.capabilities.permissionPromptRequested,false);
});
