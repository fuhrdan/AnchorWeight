import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTrafficDimensions } from '../../src/traffic-scoring.js';

function profile(overrides={}) {
  return {
    score:0, classification:'unknown', manualPolicy:null,
    goodBotVerified:false, proofOfCrawl:0, validTraversals:0, invalidTraversals:0,
    blackholeVisits:0, signalNames:[], userAgents:[],
    agentIdentity:{current:{trafficClass:'browser_or_unknown'}},
    agentBehavior:{observations:0,routeHashes:[],minuteBuckets:[],suspectedRetries:0,apiRequests:0,responseObservations:0,notFoundResponses:0,downloadResponses:0,downloadBytesObserved:0,intervalsMs:[]},
    ...overrides
  };
}

test('ordinary browser starts minimal on all three dimensions',()=>{
  const s=scoreTrafficDimensions(profile());
  assert.equal(s.automationConfidence.score,0);
  assert.equal(s.policyRisk.score,0);
  assert.equal(s.resourcePressure.score,0);
  assert.equal(s.enforcement,'legacy_score_only');
});

test('declared AI crawler is high-confidence automation without implied policy risk',()=>{
  const s=scoreTrafficDimensions(profile({agentIdentity:{current:{trafficClass:'declared_ai_crawler'}}}));
  assert.ok(s.automationConfidence.score>=85);
  assert.equal(s.policyRisk.score,0);
});

test('verified search crawler is automation, not automatically risky',()=>{
  const s=scoreTrafficDimensions(profile({goodBotVerified:true}));
  assert.equal(s.automationConfidence.score,95);
  assert.equal(s.policyRisk.score,0);
});

test('proof of crawl raises automation confidence without automatically raising policy risk',()=>{
  const s=scoreTrafficDimensions(profile({proofOfCrawl:1,validTraversals:3}));
  assert.ok(s.automationConfidence.score>=40);
  assert.equal(s.policyRisk.score,0);
});

test('robots disallowed visit and invalid signed traversal raise policy risk',()=>{
  const s=scoreTrafficDimensions(profile({blackholeVisits:1,invalidTraversals:2}));
  assert.ok(s.policyRisk.score>=80);
  assert.equal(s.resourcePressure.score,0);
});

test('manual policy is reflected explicitly',()=>{
  assert.equal(scoreTrafficDimensions(profile({manualPolicy:'allow',blackholeVisits:4})).policyRisk.score,0);
  assert.equal(scoreTrafficDimensions(profile({manualPolicy:'quarantine'})).policyRisk.score,100);
});

test('fast broad retrying downloads produce resource pressure without mutating legacy score',()=>{
  const p=profile({
    score:7,
    agentBehavior:{
      observations:30,
      routeHashes:Array.from({length:40},(_,i)=>`r${i}`),
      minuteBuckets:[{minute:1,routeHashes:Array.from({length:30},(_,i)=>`m${i}`)}],
      suspectedRetries:12,
      apiRequests:27,
      responseObservations:20,
      notFoundResponses:2,
      downloadResponses:5,
      downloadBytesObserved:120*1024*1024,
      intervalsMs:[50,75,60,55,80]
    }
  });
  const s=scoreTrafficDimensions(p);
  assert.ok(s.resourcePressure.score>=80);
  assert.equal(p.score,7);
  assert.equal(s.legacy.score,7);
});

test('all dimensions remain bounded 0-100 under extreme input',()=>{
  const p=profile({
    blackholeVisits:999, invalidTraversals:999, proofOfCrawl:999,
    signalNames:['automation_user_agent','missing_user_agent','rapid_request_burst','spoofed_good_bot_claim'],
    userAgents:Array.from({length:20},()=> 'x'),
    agentBehavior:{observations:999,routeHashes:Array.from({length:999},(_,i)=>String(i)),minuteBuckets:[{minute:1,routeHashes:Array.from({length:999},(_,i)=>String(i))}],suspectedRetries:999,apiRequests:999,responseObservations:999,notFoundResponses:999,downloadResponses:999,downloadBytesObserved:Number.MAX_SAFE_INTEGER,intervalsMs:[1,1,1,1]}
  });
  const s=scoreTrafficDimensions(p);
  for (const key of ['automationConfidence','policyRisk','resourcePressure']) {
    assert.ok(s[key].score>=0 && s[key].score<=100);
  }
});
