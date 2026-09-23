import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { MemoryStore } from '../../src/store.js';
import { PersistentStore } from '../../src/persistent-store.js';
import { createStore } from '../../src/create-store.js';
import { createAnchorWeight } from '../../src/anchorweight.js';
import { readEvents } from '../../src/logger.js';
import { ipFingerprint } from '../../src/crypto.js';
import { parseCaseQuery, buildInvestigation, buildCaseReport, formatCaseReportText, validateReview } from '../../src/investigation.js';

const KEY='abcdef1234567890';
const OTHER='12345678abcdef12';
const BOT='AW-ABCDEF12';
const CAMPAIGN='AWC-1234ABCD';
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-investigation-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'events.jsonl');
  fs.writeFileSync(file,[
    {ts:'2026-09-20T10:00:00.000Z',type:'lure',ipKey:KEY,sid:'1234567890123456',privateSecret:'do-not-export'},
    {ts:'2026-09-20T10:00:01.000Z',type:'traversal',ipKey:KEY,depth:1,branch:3,path:'/anchor/t/1234567890/secret-token?view=2'},
    {ts:'2026-09-20T10:00:02.000Z',type:'campaign_correlation',campaignId:CAMPAIGN,reason:'shared_signed_canary',members:2},
    {ts:'2026-09-20T10:00:03.000Z',type:'block',ipKey:OTHER,reason:'other'}
  ].map(JSON.stringify).join('\n')+'\n');
  const store=new MemoryStore(()=>Date.parse('2026-09-20T10:00:05Z'));
  const p=store.getProfile(KEY);p.validTraversals=1;p.evidence=[{kind:'traversal',at:Date.parse('2026-09-20T10:00:01Z'),depth:1,branch:3}];p.campaignIds=[CAMPAIGN];
  store.getProfile(OTHER);
  const c=store.getCampaign(CAMPAIGN);c.members=[KEY,OTHER];c.confidence=45;c.evidence=[{reason:'shared_signed_canary',depth:1,branch:3}];
  return {dir,file,store};
}
test('case query accepts one case, bounded filters, and rejects ambiguous or invalid selections',()=>{
  assert.equal(parseCaseQuery(new URLSearchParams('bot=aw-abcdef12&limit=20')).limit,20);
  assert.equal(parseCaseQuery(new URLSearchParams('bot=AW-MUEHTQNX')).botId,'AW-MUEHTQNX');
  assert.equal(parseCaseQuery(new URLSearchParams('bot=AW-AB_CD-12')).botId,'AW-AB_CD-12');
  const liveId = `AW-${ipFingerprint('example-secret','127.0.0.1').slice(0,8).toUpperCase()}`;
  assert.equal(parseCaseQuery(new URLSearchParams(`bot=${liveId}`)).botId,liveId);
  for(const query of ['', 'bot=AW-ABCDEF12&campaign=AWC-1234ABCD','bot=AW-INVALID!!',
    'campaign=AWC-1234ABCD&limit=10000','bot=AW-ABCDEF12&from=bad',
    'bot=AW-ABCDEF12&from=2026-09-21&to=2026-09-20']) {
    assert.throws(()=>parseCaseQuery(new URLSearchParams(query)),RangeError,query);
  }
});
test('case timeline is chronological, filtered, bounded, and exported without raw keys or signed tokens',t=>{
  const {file,store}=fixture(t);
  const opts=parseCaseQuery(new URLSearchParams(`bot=${BOT}`));
  const caseData=buildInvestigation(store,file,opts);
  assert.equal(caseData.kind,'bot');assert.equal(caseData.eventCount,2);
  assert.equal(caseData.timeline[0].type,'lure');
  assert.equal(caseData.events[0].type,'traversal');
  assert.equal(caseData.relatedCampaigns[0].id,CAMPAIGN);
  const report=buildCaseReport(caseData);
  const serialized=JSON.stringify(report);
  assert.equal(serialized.includes(KEY),false);
  assert.equal(serialized.includes('secret-token'),false);
  assert.equal(serialized.includes('do-not-export'),false);
  assert.match(formatCaseReportText(report),/LIMITATIONS/);
  const one=buildInvestigation(store,file,parseCaseQuery(new URLSearchParams(`bot=${BOT}&from=2026-09-20T10:00:01Z`)));
  assert.equal(one.eventCount,1);
});
test('campaign case includes member timelines and records correlation reason without asserting identity',t=>{
  const {file,store}=fixture(t);
  const result=buildInvestigation(store,file,parseCaseQuery(new URLSearchParams(`campaign=${CAMPAIGN}`)));
  assert.equal(result.eventCount,4);
  assert.equal(result.memberProfiles.length,2);
  assert.equal(result.campaign.evidence[0].reason,'shared_signed_canary');
  assert.match(result.limitations.join(' '),/not proof of common ownership/);
});
test('event reader redacts unknown fields, signed path tokens, and supports time filters',t=>{
  const {file}=fixture(t);
  const events=readEvents(file,{botId:BOT,from:'2026-09-20T10:00:01Z'});
  assert.equal(events.length,1);
  assert.equal(events[0].path,'/anchor/t/[signed-path-redacted]');
  assert.equal('privateSecret' in events[0],false);
});
test('analyst review validation rejects freeform invalid inputs',()=>{
  assert.deepEqual(validateReview({botId:BOT,status:'false_positive',note:'Tested manually'}),
    {botId:BOT,status:'false_positive',note:'Tested manually'});
  assert.throws(()=>validateReview({botId:BOT,status:'definitely_evil'}),RangeError);
  assert.throws(()=>validateReview({botId:BOT,status:'false_positive',note:'x'.repeat(501)}),RangeError);
  assert.throws(()=>validateReview({botId:BOT,status:'false_positive',note:'bad\0control'}),RangeError);
});
test('review survives JSON restart without changing enforcement or state version',t=>{
  const {dir}=fixture(t);const file=path.join(dir,'state.json');
  const store=new PersistentStore(file);store.getProfile(KEY);store.touchProfile(KEY);
  const changed=store.setReviewById(BOT,'false_positive','Monitor exception');
  assert.equal(changed.review.status,'false_positive');
  assert.equal(changed.manualPolicy,null);
  const reopened=new PersistentStore(file);
  assert.equal(reopened.getPublicProfileById(BOT).review.note,'Monitor exception');
  assert.equal(reopened.getPublicProfileById(BOT).manualPolicy,null);
  assert.equal(JSON.parse(fs.readFileSync(file)).version,5);
});
test('review survives SQLite restart with schema v5', {skip:Number(process.versions.node.split('.')[0])<22},async t=>{
  const {dir}=fixture(t);const c={stateBackend:'sqlite',sqliteFile:path.join(dir,'state.sqlite'),stateFile:path.join(dir,'prior.json')};
  const store=await createStore(c);store.getProfile(KEY);store.touchProfile(KEY);
  store.setReviewById(BOT,'needs_review','Investigate');store.close();
  const again=await createStore(c);
  assert.equal(again.getPublicProfileById(BOT).review.status,'needs_review');
  assert.equal(again.loadedStateVersion,5);again.close();
});

function request(method, url, headers={}) {
  const req=new EventEmitter();req.method=method;req.headers=headers;req.socket={remoteAddress:'127.0.0.1'};
  const res={headers:{},statusCode:0,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},
    end(value=''){this.body=String(value);this.resolve?.();}};
  const done=new Promise(resolve=>res.resolve=resolve);
  return {req,res,done,url:new URL(url)};
}
function fixtureApi(t){
  const x=fixture(t);const c={secret:'testing-secret',basePath:'/anchor',dashboardEnabled:true,
    dashboardToken:'tester-token',auditEnabled:false,logFile:x.file,adminBodyMaxBytes:8192,
    adminRateLimitPerMinute:100,csrfTtlMinutes:15};
  const aw=createAnchorWeight(c,{store:x.store,log:()=>{}});
  return {...x,aw};
}
test('investigation and report APIs require authentication; malformed cases are rejected',async t=>{
  const {aw}=fixtureApi(t);
  const unauthorized=request('GET',`http://localhost/anchor/api/report?bot=${BOT}`);
  aw.handle(unauthorized.req,unauthorized.res,unauthorized.url);await unauthorized.done;
  assert.equal(unauthorized.res.statusCode,401);
  const invalid=request('GET','http://localhost/anchor/api/report?bot=BAD',{authorization:'Bearer tester-token'});
  aw.handle(invalid.req,invalid.res,invalid.url);await invalid.done;
  assert.equal(invalid.res.statusCode,400);
  const authorized=request('GET',`http://localhost/anchor/api/report?bot=${BOT}&format=txt`,{authorization:'Bearer tester-token'});
  aw.handle(authorized.req,authorized.res,authorized.url);await authorized.done;
  assert.equal(authorized.res.statusCode,200);assert.match(authorized.res.body,/INVESTIGATION REPORT/);
  assert.equal(authorized.res.body.includes(KEY),false);
});
test('review API enforces bearer plus client-bound CSRF, persists review, does not change policy',async t=>{
  const {aw,store}=fixtureApi(t);const headers={authorization:'Bearer tester-token'};
  const denied=request('POST','http://localhost/anchor/api/review',headers);
  aw.handle(denied.req,denied.res,denied.url);await denied.done;
  assert.equal(denied.res.statusCode,403);
  const session=request('GET','http://localhost/anchor/api/session',headers);
  aw.handle(session.req,session.res,session.url);await session.done;
  const csrf=JSON.parse(session.res.body).csrfToken;
  const review=request('POST','http://localhost/anchor/api/review',{...headers,'x-aw-csrf':csrf});
  aw.handle(review.req,review.res,review.url);
  review.req.emit('data',Buffer.from(JSON.stringify({botId:BOT,status:'false_positive',note:'Reviewed'})));
  review.req.emit('end');await review.done;
  assert.equal(review.res.statusCode,200);
  assert.equal(store.getPublicProfileById(BOT).review.note,'Reviewed');
  assert.equal(store.getPublicProfileById(BOT).manualPolicy,null);
});
test('browser dashboard script parses as valid JavaScript',()=>{
  const source=fs.readFileSync(new URL('../../public/dashboard.html',import.meta.url),'utf8');
  const script=source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);assert.doesNotThrow(()=>new Function(script));
});
