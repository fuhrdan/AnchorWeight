import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveDeception, ADAPTIVE_INTERVENTIONS as I } from '../../src/adaptive-deception.js';

function profile(extra={}) { return {score:0,proofOfCrawl:0,maxDepth:0,invalidTraversals:0,rapidRequestCount:0,blackholeVisits:0,...extra}; }

test('adaptive deception defaults to shadow-only recommendations',()=>{
  const engine=createAdaptiveDeception({adaptiveDeceptionEnabled:true,adaptiveDeceptionShadowMode:true});
  const r=engine.recommend(profile({score:80,proofOfCrawl:1,maxDepth:4}));
  assert.equal(r.type,I.DEPTH_EXTENSION); assert.equal(r.shadowOnly,true);
});

test('records attacker-cost telemetry for shadow traversal',()=>{
  let t=1000; const engine=createAdaptiveDeception({},()=>{},()=>t);
  const p=profile({score:60,proofOfCrawl:1,maxDepth:3});
  const out=engine.observe(p,{kind:'traversal',depth:3,elapsedMs:425});
  assert.equal(out.attackerCost.requestsDiverted,1);
  assert.equal(out.attackerCost.originRequestsPrevented,1);
  assert.equal(out.attackerCost.shadowTraversals,1);
  assert.equal(out.attackerCost.additionalDepth,3);
  assert.equal(out.attackerCost.estimatedDelayMs,425);
});

test('repeated invalid enumeration recommends shadow branch',()=>{
  const engine=createAdaptiveDeception({});
  assert.equal(engine.recommend(profile({score:30,invalidTraversals:3})).type,I.SHADOW_BRANCH);
});

test('disabled engine recommends normal response',()=>{
  const engine=createAdaptiveDeception({adaptiveDeceptionEnabled:false});
  assert.equal(engine.recommend(profile({score:999,proofOfCrawl:5,maxDepth:8})).type,I.NORMAL_RESPONSE);
});
