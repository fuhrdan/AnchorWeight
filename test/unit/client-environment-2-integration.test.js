import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTrafficDimensions } from '../../src/traffic-scoring.js';

test('webdriver observation raises Automation Confidence only',()=>{
  const p={
    score:0,classification:'unknown',manualPolicy:null,goodBotVerified:false,proofOfCrawl:0,
    validTraversals:0,invalidTraversals:0,blackholeVisits:0,signalNames:[],userAgents:[],
    agentIdentity:{current:{trafficClass:'browser_or_unknown'}},
    agentBehavior:{observations:0,routeHashes:[],minuteBuckets:[],suspectedRetries:0,apiRequests:0,responseObservations:0,notFoundResponses:0,downloadResponses:0,downloadBytesObserved:0,intervalsMs:[]},
    clientEnvironment:{headlessConsistency:{webdriver:true,automationControlled:true,indicators:['webdriver_automation_controlled']}}
  };
  const s=scoreTrafficDimensions(p);
  assert.ok(s.automationConfidence.score>=35);
  assert.equal(s.policyRisk.score,0);
  assert.equal(s.resourcePressure.score,0);
  assert.equal(s.legacy.score,0);
  assert.equal(p.score,0);
});

test('extended-screen state alone does not raise any dimension',()=>{
  const p={
    score:0,classification:'unknown',manualPolicy:null,goodBotVerified:false,proofOfCrawl:0,
    validTraversals:0,invalidTraversals:0,blackholeVisits:0,signalNames:[],userAgents:[],
    agentIdentity:{current:{trafficClass:'browser_or_unknown'}},
    agentBehavior:{observations:0,routeHashes:[],minuteBuckets:[],suspectedRetries:0,apiRequests:0,responseObservations:0,notFoundResponses:0,downloadResponses:0,downloadBytesObserved:0,intervalsMs:[]},
    clientEnvironment:{headlessConsistency:{webdriver:false,multiScreenState:'extended'}}
  };
  const s=scoreTrafficDimensions(p);
  assert.equal(s.automationConfidence.score,0);
  assert.equal(s.policyRisk.score,0);
  assert.equal(s.resourcePressure.score,0);
});
