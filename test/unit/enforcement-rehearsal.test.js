import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnforcementRehearsal, enforcementRehearsalDescriptor } from '../../src/enforcement-rehearsal.js';

const actions=()=>({allow:0,observe:0,budget:0,throttle:0,decoy:0,quarantine:0});
function profile({id='AW-12345678',review=null,current='allow',evaluations=0,counts={},high=0,recent=[],automation=0,risk=0,pressure=0}={}) {
  return {
    id,
    review:review?{status:review}:null,
    trafficScores:{automationConfidence:{score:automation},policyRisk:{score:risk},resourcePressure:{score:pressure}},
    policyDecision:{action:current},
    policyForensics:{evaluations,highImpactRecommendations:high,currentAction:current,actionCounts:{...actions(),...counts},recent}
  };
}

test('empty rehearsal is collecting, advisory-only and non-enforcing',()=>{
  const r=buildEnforcementRehearsal([],{now:1_000_000});
  assert.equal(r.verdict,'collecting');
  assert.equal(r.advisoryOnly,true);
  assert.equal(r.mutatesState,false);
  assert.equal(r.enforcement,false);
  assert.equal(r.evaluations,0);
});

test('rehearsal aggregates policy evaluation action counts without mutating profiles',()=>{
  const p=profile({evaluations:12,high:3,current:'throttle',counts:{allow:2,observe:4,budget:3,throttle:3}});
  const before=JSON.stringify(p);
  const r=buildEnforcementRehearsal([p],{now:2_000_000});
  assert.equal(r.evaluations,12);
  assert.equal(r.actionCounts.throttle,3);
  assert.equal(r.currentActions.throttle,1);
  assert.equal(JSON.stringify(p),before);
});

test('recent window counts bounded decision transitions rather than pretending they are request totals',()=>{
  const now=100_000_000;
  const p=profile({evaluations:10,recent:[
    {at:now-1_000,action:'observe'},
    {at:now-2_000,action:'decoy'},
    {at:now-(25*60*60*1000),action:'quarantine'}
  ]});
  const r=buildEnforcementRehearsal([p],{now});
  assert.equal(r.recentWindow.decisionTransitions,2);
  assert.equal(r.recentWindow.actionCounts.observe,1);
  assert.equal(r.recentWindow.actionCounts.decoy,1);
  assert.equal(r.recentWindow.actionCounts.quarantine,0);
});

test('false-positive label receiving a high-impact current action requires review',()=>{
  const r=buildEnforcementRehearsal([
    profile({review:'false_positive',current:'decoy',evaluations:120,high:5,risk:80}),
    ...Array.from({length:9},(_,i)=>profile({id:`AW-AAA0000${i}`.slice(0,11),review:'confirmed_automation',current:'observe'}))
  ],{now:5_000_000});
  assert.equal(r.verdict,'review_required');
  assert.equal(r.analystComparison.falsePositiveHighImpactConflicts,1);
});

test('confirmed automation currently allowed is informational, not automatically a safety conflict',()=>{
  const r=buildEnforcementRehearsal([profile({review:'confirmed_automation',current:'allow',automation:90})]);
  assert.equal(r.analystComparison.confirmedAutomationCurrentlyAllowed,1);
  assert.equal(r.analystComparison.falsePositiveHighImpactConflicts,0);
});

test('sufficient stable evidence with no false-positive conflicts can clear rehearsal review',()=>{
  const ps=[];
  for(let i=0;i<5;i++) ps.push(profile({id:`AW-FP00000${i}`,review:'false_positive',current:'observe',evaluations:12,counts:{observe:12}}));
  for(let i=0;i<5;i++) ps.push(profile({id:`AW-CA00000${i}`,review:'confirmed_automation',current:'observe',evaluations:12,counts:{observe:11,throttle:1},high:1}));
  const r=buildEnforcementRehearsal(ps,{now:7_000_000});
  assert.equal(r.evaluations,120);
  assert.ok(r.highImpactRate<=25);
  assert.equal(r.verdict,'clear_for_controlled_trial_review');
  assert.equal(r.controlledTrialCandidate,true);
});

test('rehearsal output is privacy-minimized even if input contains raw-looking extras',()=>{
  const p=profile({review:'false_positive',current:'throttle',evaluations:110,high:2});
  p.rawIp='203.0.113.77';p.headers={authorization:'Bearer SECRET'};p.path='/private?q=secret';p.origin='https://origin.example';
  const text=JSON.stringify(buildEnforcementRehearsal([p]));
  for(const forbidden of ['203.0.113.77','Bearer SECRET','/private?q=secret','origin.example']) assert.equal(text.includes(forbidden),false);
  assert.equal(enforcementRehearsalDescriptor().enforcement,false);
});
