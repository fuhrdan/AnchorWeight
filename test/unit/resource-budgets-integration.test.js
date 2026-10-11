import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAgentBehavior, emptyAgentBehavior } from '../../src/agent-behavior.js';
import { evaluateResourceBudget } from '../../src/resource-budgets.js';

function profile(){return {score:11,agentBehavior:emptyAgentBehavior(),robotsRequests:0,blackholeVisits:0,lureVisits:0,validTraversals:0,invalidTraversals:0,proofOfCrawl:0,maxDepth:0,traversalStyle:'unknown'};}
const cfg={resourceBudgetsEnabled:true,resourceBudgetRequestsPerMinute:3,resourceBudgetUniqueUrlsPerMinute:3,resourceBudgetRouteBreadth5m:10,resourceBudgetRetriesPerMinute:2,resourceBudgetPressureScore:70,resourceBudgetApproachPercent:80};

test('agent behavior maintains a true current-minute request counter',()=>{
  const p=profile();
  observeAgentBehavior(p,{method:'GET',headers:{}},new URL('https://x.test/a'),{now:1000,secret:'x'});
  observeAgentBehavior(p,{method:'GET',headers:{}},new URL('https://x.test/b'),{now:2000,secret:'x'});
  assert.equal(p.agentBehavior.minuteBuckets.at(-1).requests,2);
});

test('current-minute retry budget is based on current bucket',()=>{
  const p=profile();
  observeAgentBehavior(p,{method:'GET',headers:{}},new URL('https://x.test/a'),{now:1000,secret:'x'});
  observeAgentBehavior(p,{method:'GET',headers:{}},new URL('https://x.test/a'),{now:2000,secret:'x'});
  observeAgentBehavior(p,{method:'GET',headers:{}},new URL('https://x.test/a'),{now:3000,secret:'x'});
  const b=evaluateResourceBudget(p,{resourcePressure:{score:10}},cfg,{now:3000});
  assert.equal(b.observed.retriesPerMinute,2);
  assert.ok(b.exceeded.includes('retriesPerMinute'));
});

test('minute rollover starts a new request budget window',()=>{
  const p=profile();
  observeAgentBehavior(p,{method:'GET',headers:{}},new URL('https://x.test/a'),{now:59000,secret:'x'});
  observeAgentBehavior(p,{method:'GET',headers:{}},new URL('https://x.test/b'),{now:61000,secret:'x'});
  const b=evaluateResourceBudget(p,{resourcePressure:{score:0}},cfg,{now:61000});
  assert.equal(b.observed.requestsPerMinute,1);
  assert.equal(b.observed.uniqueUrlsPerMinute,1);
  assert.equal(b.observed.routeBreadth5m,2);
});

test('budget evaluation cannot change legacy score',()=>{
  const p=profile();
  p.agentBehavior.minuteBuckets=[{minute:1,requests:999,retries:999,routeHashes:Array.from({length:64},(_,i)=>String(i))}];
  const before=p.score;
  const b=evaluateResourceBudget(p,{resourcePressure:{score:100}},cfg);
  assert.equal(b.status,'exceeded');
  assert.equal(p.score,before);
});
