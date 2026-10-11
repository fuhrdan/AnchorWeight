import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../src/store.js';

function profile(store,key,{cls='unknown_automation',purpose='general_automation',automation=70,policy=0,pressure=0}={}) {
  const p=store.getProfile(key);
  p.requestCount=10;
  p.agentIdentity={observations:1,lastAt:1,current:{trafficClass:cls,purpose,confidence:'heuristic',provider:null,family:null,evidence:[]},history:[]};
  p.agentBehavior={observations:10,firstAt:1,lastAt:1000,routeHashes:[],minuteBuckets:[],maxNavigationDepth:1,methodCounts:{GET:10},recentRequests:[],suspectedRetries:0,cookieObservations:0,noCookieObservations:10,cookieHashes:[],apiRequests:0,downloadIntentRequests:0,responseObservations:0,notFoundResponses:0,downloadResponses:0,downloadBytesObserved:0,downloadBytesKnownResponses:0,intervalsMs:[]};
  p.__testScores={automation,policy,pressure};
  return p;
}

test('store snapshot includes agent observatory without removing legacy topProfiles',()=>{
  const store=new MemoryStore(()=>1000);
  const p=profile(store,'abcdef0123456789');
  // Drive real score derivation with identity; exact numeric values are intentionally not asserted here.
  p.agentIdentity.current.trafficClass='declared_ai_crawler';
  const s=store.snapshot();
  assert.ok(Array.isArray(s.topProfiles));
  assert.ok(s.agentObservatory);
  assert.equal(s.agentObservatory.trackedProfiles,1);
  assert.equal(s.agentObservatory.enforcement,'observation_only');
});

test('agent observatory exposes only public Bot DNA IDs in top lists',()=>{
  const store=new MemoryStore(()=>1000);
  profile(store,'abcdef0123456789',{cls:'unknown_automation'});
  const text=JSON.stringify(store.snapshot().agentObservatory);
  assert.match(text,/AW-ABCDEF01/);
  assert.doesNotMatch(text,/abcdef0123456789/);
});

test('observatory aggregation does not mutate legacy enforcement score',()=>{
  const store=new MemoryStore(()=>1000);
  const p=profile(store,'0123456789abcdef');
  p.score=17;
  store.snapshot();
  assert.equal(p.score,17);
});
