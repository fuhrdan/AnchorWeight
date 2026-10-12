import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePolicyCalibration,
  buildReleaseReadiness,
  releaseReadinessDescriptor
} from '../../src/release-readiness.js';

function profile(id, review, automation, risk, pressure, extra={}) {
  return {
    id,
    review:{status:review},
    trafficScores:{automationConfidence:{score:automation},policyRisk:{score:risk},resourcePressure:{score:pressure}},
    proofOfCrawl:0,blackholeVisits:0,invalidTraversals:0,
    ...extra
  };
}

const config={proxyEnabled:true,policyEngineEnabled:true,shadowMode:true,policyEngineShadowMode:true,
  policyObserveAutomation:65,policyThrottlePressure:70,policyDecoyRisk:65,policyQuarantineRisk:85};

test('calibration refuses to invent threshold recommendations without labels',()=>{
  const result=analyzePolicyCalibration([profile('AW-1','needs_review',90,80,70)],config);
  assert.equal(result.sufficientLabeledEvidence,false);
  assert.equal(result.candidate.observeAutomation,65);
  assert.equal(result.candidate.decoyRisk,65);
});

test('separated analyst labels can produce bounded advisory candidates',()=>{
  const rows=[];
  for(let i=0;i<5;i++) rows.push(profile(`AW-F${i}`,'false_positive',20+i,10+i,25+i));
  for(let i=0;i<5;i++) rows.push(profile(`AW-C${i}`,'confirmed_automation',80+i,75+i,82+i,{proofOfCrawl:1}));
  const before=JSON.stringify(rows);
  const result=analyzePolicyCalibration(rows,config);
  assert.equal(result.sufficientLabeledEvidence,true);
  assert.equal(result.recommendations.observeAutomation.status,'separated_candidate');
  assert.ok(result.candidate.observeAutomation>24 && result.candidate.observeAutomation<80);
  assert.ok(result.candidate.quarantineRisk>=result.candidate.decoyRisk);
  assert.equal(JSON.stringify(rows),before);
});

test('degraded client identity is a hard readiness blocker',()=>{
  const readiness=buildReleaseReadiness({config,clientIdentity:{status:'degraded',reason:'proxy_client_ip_unavailable',enforcementSafe:false},
    publicProfiles:[],agentObservatory:{policyCalibration:{evaluations:200,highImpactRecommendations:5}},totalProfiles:20});
  assert.equal(readiness.verdict,'blocked');
  assert.equal(readiness.enforcementReady,false);
  assert.equal(readiness.checks.find(x=>x.id==='client_identity').status,'fail');
});

test('safe identity still remains calibrating without enough labeled evidence',()=>{
  const readiness=buildReleaseReadiness({config,clientIdentity:{status:'trusted',enforcementSafe:true},
    publicProfiles:[],agentObservatory:{policyCalibration:{evaluations:200,highImpactRecommendations:5}},totalProfiles:20});
  assert.equal(readiness.verdict,'calibrating');
  assert.equal(readiness.enforcementReady,false);
});

test('sufficient labels and stable shadow observations reach controlled-review readiness',()=>{
  const rows=[];
  for(let i=0;i<5;i++) rows.push(profile(`AW-F${i}`,'false_positive',20+i,10+i,25+i));
  for(let i=0;i<5;i++) rows.push(profile(`AW-C${i}`,'confirmed_automation',80+i,75+i,82+i,{proofOfCrawl:1}));
  const readiness=buildReleaseReadiness({config,clientIdentity:{status:'trusted',enforcementSafe:true},publicProfiles:rows,
    agentObservatory:{policyCalibration:{evaluations:250,highImpactRecommendations:25}},totalProfiles:rows.length});
  assert.equal(readiness.verdict,'ready_for_controlled_enforcement_review');
  assert.equal(readiness.enforcementReady,true);
  assert.equal(readiness.externalReleaseGateRequired,true);
});

test('high intervention rate keeps an otherwise healthy installation calibrating',()=>{
  const rows=[];
  for(let i=0;i<5;i++) rows.push(profile(`AW-F${i}`,'false_positive',20+i,10+i,25+i));
  for(let i=0;i<5;i++) rows.push(profile(`AW-C${i}`,'confirmed_automation',80+i,75+i,82+i,{proofOfCrawl:1}));
  const readiness=buildReleaseReadiness({config,clientIdentity:{status:'trusted',enforcementSafe:true},publicProfiles:rows,
    agentObservatory:{policyCalibration:{evaluations:200,highImpactRecommendations:100}}});
  assert.equal(readiness.verdict,'calibrating');
  assert.equal(readiness.highImpactRate,50);
});

test('readiness descriptor is explicitly advisory and non-enforcing',()=>{
  const descriptor=releaseReadinessDescriptor();
  assert.equal(descriptor.advisoryOnly,true);
  assert.equal(descriptor.mutatesState,false);
  assert.equal(descriptor.enforcement,false);
});
