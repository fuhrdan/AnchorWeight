import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyResourceBudget, evaluateResourceBudget, publicResourceBudget } from '../../src/resource-budgets.js';

function profile(overrides={}) {
  return {
    score: 7,
    agentBehavior: {
      minuteBuckets: [{minute:1,requests:10,retries:1,routeHashes:['a','b','c']}],
      ...overrides.agentBehavior
    },
    ...overrides
  };
}

const scores = pressure => ({resourcePressure:{score:pressure}});
const config = overrides => ({
  resourceBudgetsEnabled:true,
  resourceBudgetRequestsPerMinute:100,
  resourceBudgetUniqueUrlsPerMinute:20,
  resourceBudgetRouteBreadth5m:40,
  resourceBudgetRetriesPerMinute:10,
  resourceBudgetPressureScore:70,
  resourceBudgetApproachPercent:80,
  ...overrides
});

test('disabled budgets remain inert',()=>{
  const p=profile();
  const before=p.score;
  const b=evaluateResourceBudget(p,scores(90),{resourceBudgetsEnabled:false});
  assert.equal(b.status,'disabled');
  assert.equal(b.enforcement,'shadow_only');
  assert.equal(p.score,before);
});

test('normal traffic remains within budget',()=>{
  const b=evaluateResourceBudget(profile(),scores(20),config(),{now:123});
  assert.equal(b.status,'within_budget');
  assert.equal(b.evaluatedAt,123);
  assert.deepEqual(b.exceeded,[]);
});

test('approaching budget is distinct from exceeded',()=>{
  const p=profile({agentBehavior:{minuteBuckets:[{minute:1,requests:80,retries:1,routeHashes:['a']} ]}});
  const b=evaluateResourceBudget(p,scores(20),config());
  assert.equal(b.status,'approaching');
  assert.ok(b.approaching.includes('requestsPerMinute'));
  assert.equal(b.exceeded.length,0);
});

test('multiple exceeded dimensions are reported without enforcement',()=>{
  const routes=Array.from({length:30},(_,i)=>`r${i}`);
  const p=profile({agentBehavior:{minuteBuckets:[{minute:1,requests:140,retries:22,routeHashes:routes}]}});
  const before=p.score;
  const b=evaluateResourceBudget(p,scores(92),config());
  assert.equal(b.status,'exceeded');
  assert.ok(b.exceeded.includes('requestsPerMinute'));
  assert.ok(b.exceeded.includes('uniqueUrlsPerMinute'));
  assert.ok(b.exceeded.includes('retriesPerMinute'));
  assert.ok(b.exceeded.includes('resourcePressure'));
  assert.equal(b.wouldAction,'budget_exceeded');
  assert.equal(p.score,before);
});

test('five-minute route breadth is deduplicated and bounded',()=>{
  const p=profile({agentBehavior:{minuteBuckets:[
    {minute:1,requests:1,retries:0,routeHashes:['a','b']},
    {minute:2,requests:1,retries:0,routeHashes:['b','c']},
    {minute:3,requests:1,retries:0,routeHashes:['d']}
  ]}});
  const b=evaluateResourceBudget(p,scores(0),config({resourceBudgetRouteBreadth5m:4}));
  assert.equal(b.observed.routeBreadth5m,4);
  assert.ok(b.exceeded.includes('routeBreadth5m'));
});

test('utilization is bounded for extreme observations',()=>{
  const p=profile({agentBehavior:{minuteBuckets:[{minute:1,requests:999999,retries:999999,routeHashes:Array.from({length:64},(_,i)=>String(i))}]}});
  const b=evaluateResourceBudget(p,scores(100),config());
  for (const value of Object.values(b.utilization)) assert.ok(value>=0 && value<=999);
});

test('public projection is bounded and privacy-safe',()=>{
  const p=profile();
  p.resourceBudget=evaluateResourceBudget(p,scores(20),config());
  p.resourceBudget.secret='do-not-leak';
  const pub=publicResourceBudget(p);
  assert.equal(pub.secret,undefined);
  assert.equal(pub.enforcement,'shadow_only');
  assert.deepEqual(publicResourceBudget({}),emptyResourceBudget());
});
