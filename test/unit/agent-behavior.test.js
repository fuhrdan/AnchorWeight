import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAgentBehavior, observeAgentResponse, publicAgentBehavior, emptyAgentBehavior } from '../../src/agent-behavior.js';

function profile() {
  return { agentBehavior:emptyAgentBehavior(), robotsRequests:0, blackholeVisits:0, lureVisits:0, validTraversals:0, invalidTraversals:0, proofOfCrawl:0, maxDepth:0, traversalStyle:'unknown' };
}
function req(path='/', options={}) {
  return { method:options.method || 'GET', headers:{ ...(options.headers || {}) } };
}
function url(path) { return new URL(path, 'https://example.test'); }
function res(status=200, headers={}) {
  return { statusCode:status, getHeader(name){ return headers[String(name).toLowerCase()]; } };
}

test('route behavior is aggregated without retaining raw path or query',()=>{
  const p=profile();
  observeAgentBehavior(p,req(),url('/account/123?token=secret'),{now:1000,secret:'test-secret'});
  observeAgentBehavior(p,req(),url('/api/items?id=999'),{now:2000,secret:'test-secret'});
  const text=JSON.stringify(p.agentBehavior);
  assert.equal(publicAgentBehavior(p).routeBreadth,2);
  assert.doesNotMatch(text,/account|123|token|secret|api\/items|999/);
});

test('current-minute URL breadth and navigation depth are measured',()=>{
  const p=profile();
  observeAgentBehavior(p,req(),url('/a'),{now:60_000,secret:'s'});
  observeAgentBehavior(p,req(),url('/a/b/c'),{now:61_000,secret:'s'});
  observeAgentBehavior(p,req(),url('/a/b/c'),{now:62_000,secret:'s'});
  const out=publicAgentBehavior(p);
  assert.equal(out.uniqueUrlsCurrentMinute,2);
  assert.equal(out.maxNavigationDepth,3);
});

test('method mix and short-window retry behavior are descriptive only',()=>{
  const p=profile();
  observeAgentBehavior(p,req('/x',{method:'GET'}),url('/x'),{now:1_000,secret:'s'});
  observeAgentBehavior(p,req('/x',{method:'GET'}),url('/x'),{now:5_000,secret:'s'});
  observeAgentBehavior(p,req('/x',{method:'HEAD'}),url('/x'),{now:6_000,secret:'s'});
  const out=publicAgentBehavior(p);
  assert.deepEqual(out.methods,{GET:2,HEAD:1,other:0});
  assert.equal(out.suspectedRetries,1);
  assert.equal(out.headToGetRatio,0.5);
});

test('cookie continuity is privacy-minimized and bounded',()=>{
  const p=profile();
  for(let i=0;i<20;i++) observeAgentBehavior(p,req('/',{headers:{cookie:`session=private-${i}`}}),url('/'),{now:i*20_000,secret:'s'});
  const raw=JSON.stringify(p.agentBehavior);
  assert.equal(p.agentBehavior.cookieHashes.length,8);
  assert.equal(publicAgentBehavior(p).cookieContinuity.cookieVariants,8);
  assert.doesNotMatch(raw,/private-/);
});

test('API concentration and download intent are counted without declaring risk',()=>{
  const p=profile();
  observeAgentBehavior(p,req(),url('/api/items'),{now:1_000,secret:'s'});
  observeAgentBehavior(p,req(),url('/graphql'),{now:2_000,secret:'s'});
  observeAgentBehavior(p,req(),url('/files/report.pdf'),{now:3_000,secret:'s'});
  observeAgentBehavior(p,req(),url('/home'),{now:4_000,secret:'s'});
  const out=publicAgentBehavior(p);
  assert.equal(out.apiRequests,2);
  assert.equal(out.apiConcentrationPercent,50);
  assert.equal(out.downloadIntentRequests,1);
});

test('response observation counts 404s and only known download bytes',()=>{
  const p=profile();
  observeAgentResponse(p,req(),res(404),url('/missing'),{now:1_000});
  observeAgentResponse(p,req(),res(200,{'content-type':'application/pdf','content-length':'4096'}),url('/file.pdf'),{now:2_000});
  observeAgentResponse(p,req(),res(200,{'content-type':'application/octet-stream'}),url('/stream'),{now:3_000});
  const out=publicAgentBehavior(p).responses;
  assert.equal(out.observed,3);
  assert.equal(out.notFound,1);
  assert.equal(out.downloadResponses,2);
  assert.equal(out.downloadBytesObserved,4096);
  assert.equal(out.downloadBytesKnownResponses,1);
});

test('timing regularity is descriptive and requires enough samples',()=>{
  const p=profile();
  observeAgentBehavior(p,req(),url('/1'),{now:0,secret:'s'});
  observeAgentBehavior(p,req(),url('/2'),{now:1_000,secret:'s'});
  observeAgentBehavior(p,req(),url('/3'),{now:2_000,secret:'s'});
  observeAgentBehavior(p,req(),url('/4'),{now:3_000,secret:'s'});
  const out=publicAgentBehavior(p).timing;
  assert.equal(out.samples,3);
  assert.equal(out.averageIntervalMs,1000);
  assert.equal(out.regularityPercent,100);
});

test('robots and lure metrics summarize existing proof evidence without reclassifying it',()=>{
  const p=profile();
  p.robotsRequests=1;p.blackholeVisits=1;p.lureVisits=3;p.validTraversals=2;p.invalidTraversals=1;p.proofOfCrawl=1;p.maxDepth=3;p.traversalStyle='depth_first';
  const out=publicAgentBehavior(p);
  assert.equal(out.robots.compliance,'violation_observed');
  assert.deepEqual(out.lureBehavior,{lureVisits:3,validTraversals:2,invalidTraversals:1,proofOfCrawl:1,maxDepth:3,traversalStyle:'depth_first'});
});
