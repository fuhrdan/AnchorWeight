import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorEngine, newProfile, publicProfile } from '../../src/behavior.js';

function enforcementHarness(profile, { enabled=true, threshold=10 } = {}) {
  return {
    store:{getProfile(){return profile;}},
    config:{scoreEnforcementEnabled:enabled,quarantineScore:threshold}
  };
}

test('public profile exposes three-dimensional scores without changing legacy score',()=>{
  const p=newProfile();
  p.agentIdentity.current={trafficClass:'declared_ai_crawler'};
  p.agentBehavior.observations=30;
  p.agentBehavior.intervalsMs=[50,60,55,65,45];
  p.agentBehavior.routeHashes=Array.from({length:30},(_,i)=>`r${i}`);
  p.agentBehavior.minuteBuckets=[{minute:1,routeHashes:Array.from({length:25},(_,i)=>`m${i}`)}];
  p.agentBehavior.apiRequests=28;

  const projected=publicProfile('abcdef123456',p);
  assert.equal(projected.score,0);
  assert.ok(projected.trafficScores.automationConfidence.score>=85);
  assert.ok(projected.trafficScores.resourcePressure.score>0);
  assert.equal(projected.trafficScores.enforcement,'legacy_score_only');
  assert.equal(p.score,0);
});

test('high derived scores cannot independently trigger shouldQuarantine',()=>{
  const p=newProfile();
  p.agentIdentity.current={trafficClass:'declared_ai_crawler'};
  p.agentBehavior.observations=50;
  p.agentBehavior.intervalsMs=[10,10,10,10];
  p.agentBehavior.routeHashes=Array.from({length:50},(_,i)=>`r${i}`);
  p.agentBehavior.minuteBuckets=[{minute:1,routeHashes:Array.from({length:50},(_,i)=>`m${i}`)}];

  const projected=publicProfile('abcdef123456',p);
  assert.ok(projected.trafficScores.automationConfidence.score>=85);
  assert.ok(projected.trafficScores.resourcePressure.score>0);
  assert.equal(BehaviorEngine.prototype.shouldQuarantine.call(enforcementHarness(p),'abcdef123456'),false);
});

test('legacy score remains sufficient for score enforcement regardless of derived dimensions',()=>{
  const p=newProfile();
  p.score=15;
  const projected=publicProfile('abcdef123456',p);
  assert.equal(projected.trafficScores.automationConfidence.score,0);
  assert.equal(projected.trafficScores.resourcePressure.score,0);
  assert.equal(BehaviorEngine.prototype.shouldQuarantine.call(enforcementHarness(p),'abcdef123456'),true);
});
