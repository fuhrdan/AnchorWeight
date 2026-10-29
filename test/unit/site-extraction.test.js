import test from 'node:test';
import assert from 'node:assert/strict';
import {
  observeSiteExtraction,
  refreshSiteExtraction,
  publicSiteExtraction,
  emptySiteExtraction
} from '../../src/site-extraction.js';

function profile()
{
  return {
    score: 0,
    agentBehavior: {
      observations:0,
      routeHashes:[],
      minuteBuckets:[],
      cookieObservations:0,
      noCookieObservations:0,
      intervalsMs:[],
      responseObservations:0,
      notFoundResponses:0,
      downloadResponses:0,
      downloadBytesObserved:0
    },
    siteExtraction: emptySiteExtraction()
  };
}

function hash(i)
{
  return `h${String(i).padStart(3,'0')}`;
}

function addBehavior(p, i, now, { cookie=false, interval=500, status404=false } = {})
{
  const minute=Math.floor(now/60000);
  let bucket=p.agentBehavior.minuteBuckets[p.agentBehavior.minuteBuckets.length-1];
  if(!bucket || bucket.minute!==minute)
  {
    bucket={minute,routeHashes:[],requests:0,retries:0};
    p.agentBehavior.minuteBuckets.push(bucket);
    if(p.agentBehavior.minuteBuckets.length>5) p.agentBehavior.minuteBuckets.shift();
  }
  p.agentBehavior.observations++;
  p.agentBehavior.routeHashes.push(hash(i));
  if(p.agentBehavior.routeHashes.length>64) p.agentBehavior.routeHashes.shift();
  bucket.requests++;
  bucket.routeHashes.push(hash(i));
  if(p.agentBehavior.observations>1) p.agentBehavior.intervalsMs.push(interval);
  if(p.agentBehavior.intervalsMs.length>32) p.agentBehavior.intervalsMs.shift();
  if(cookie) p.agentBehavior.cookieObservations++;
  else p.agentBehavior.noCookieObservations++;
  if(status404)
  {
    p.agentBehavior.responseObservations++;
    p.agentBehavior.notFoundResponses++;
  }
}

function request(path, ua='Mozilla/5.0', extra={})
{
  return {
    method:'GET',
    headers:{
      'user-agent':ua,
      accept:'text/html,application/xhtml+xml',
      ...extra
    }
  };
}

test('empty detector is non-enforcing and privacy-safe',()=>{
  const p=profile();
  const out=publicSiteExtraction(p);
  assert.equal(out.score,0);
  assert.equal(out.enforcement,false);
  assert.equal(out.observationOnly,true);
  assert.equal(out.privacy.rawPathRetained,false);
  assert.equal(out.privacy.rawQueryRetained,false);
  assert.equal(out.privacy.rawCookieRetained,false);
  assert.equal(out.privacy.rawUserAgentRetained,false);
});

test('a single curl request is not treated as bulk scraping',()=>{
  const p=profile();
  const now=1_000_000;
  addBehavior(p,0,now);
  const out=observeSiteExtraction(
    p,
    {method:'GET',headers:{'user-agent':'curl/8.10.0',accept:'*/*'}},
    new URL('https://example.test/'),
    {now,secret:'s'}
  );
  assert.equal(out.likelyBulkScrape,false);
  assert.ok(out.score<25);
});

test('normal browser-like navigation stays below likely-bulk threshold',()=>{
  const p=profile();
  let now=1_000_000;
  for(let i=0;i<24;i++)
  {
    addBehavior(p,i,now,{cookie:i>0,interval:3500});
    observeSiteExtraction(
      p,
      request(`/article/${i}`,'Mozilla/5.0',{
        cookie:i>0?'session=opaque':'',
        'sec-fetch-dest':'document',
        'sec-fetch-mode':'navigate',
        'sec-fetch-site':'same-origin'
      }),
      new URL(`https://example.test/article/${i}`),
      {now,secret:'s'}
    );
    now+=3500;
  }
  const out=publicSiteExtraction(p);
  assert.equal(out.likelyBulkScrape,false);
});

test('broad command-line site walk is identified as likely bulk scraping',()=>{
  const p=profile();
  let now=2_000_000;
  for(let i=0;i<45;i++)
  {
    addBehavior(p,i,now,{interval:500});
    observeSiteExtraction(
      p,
      {method:'GET',headers:{'user-agent':'curl/8.10.0',accept:'*/*'}},
      new URL(`https://example.test/pages/${i}`),
      {now,secret:'s'}
    );
    now+=500;
  }
  const out=publicSiteExtraction(p);
  assert.equal(out.likelyBulkScrape,true);
  assert.ok(out.score>=60);
  assert.ok(out.reasons.some(x=>x.code==='high_unique_url_breadth'));
});

test('spoofing a browser user-agent does not hide bulk extraction behavior',()=>{
  const p=profile();
  let now=3_000_000;
  for(let i=0;i<50;i++)
  {
    addBehavior(p,i,now,{interval:450});
    observeSiteExtraction(
      p,
      request(`/catalog/item-${i}`,'Mozilla/5.0'),
      new URL(`https://example.test/catalog/item-${i}`),
      {now,secret:'s'}
    );
    now+=450;
  }
  const out=publicSiteExtraction(p);
  assert.equal(out.likelyBulkScrape,true);
  assert.equal(out.evidence.explicitToolUaRequests,0);
});

test('numeric resource enumeration produces explainable evidence',()=>{
  const p=profile();
  let now=4_000_000;
  for(let i=1000;i<1030;i++)
  {
    addBehavior(p,i,now,{interval:600});
    observeSiteExtraction(
      p,
      request(`/products/${i}`),
      new URL(`https://example.test/products/${i}`),
      {now,secret:'s'}
    );
    now+=600;
  }
  const out=publicSiteExtraction(p);
  assert.ok(out.reasons.some(x=>x.code==='numeric_resource_enumeration'));
  assert.ok(out.reasons.some(x=>x.code==='enumeration_shape_concentration'));
});

test('slow broad walk accumulates breadth evidence without requiring curl identity',()=>{
  const p=profile();
  let now=5_000_000;
  for(let i=0;i<55;i++)
  {
    addBehavior(p,i,now,{interval:5000});
    observeSiteExtraction(
      p,
      request(`/knowledge/${i}`),
      new URL(`https://example.test/knowledge/${i}`),
      {now,secret:'s'}
    );
    now+=5000;
  }
  const out=publicSiteExtraction(p);
  assert.ok(out.score>=45);
  assert.ok(out.reasons.some(x=>x.code==='broad_unique_content_walk'));
});

test('404-heavy enumeration raises extraction evidence',()=>{
  const p=profile();
  let now=6_000_000;
  for(let i=0;i<25;i++)
  {
    addBehavior(p,i,now,{interval:700,status404:i<10});
    observeSiteExtraction(
      p,
      request(`/guess/${i}`),
      new URL(`https://example.test/guess/${i}`),
      {now,secret:'s'}
    );
    now+=700;
  }
  refreshSiteExtraction(p,{now});
  const out=publicSiteExtraction(p);
  assert.ok(out.reasons.some(x=>x.code==='enumeration_not_found_pattern'));
});

test('detector never mutates legacy score',()=>{
  const p=profile();
  p.score=37;
  let now=7_000_000;
  for(let i=0;i<40;i++)
  {
    addBehavior(p,i,now,{interval:300});
    observeSiteExtraction(
      p,
      {method:'GET',headers:{'user-agent':'curl/8.10.0',accept:'*/*'}},
      new URL(`https://example.test/archive/${i}`),
      {now,secret:'s'}
    );
    now+=300;
  }
  assert.equal(p.score,37);
});

test('public output retains no raw path, query, cookie, or user-agent values',()=>{
  const p=profile();
  const now=8_000_000;
  addBehavior(p,1,now);
  observeSiteExtraction(
    p,
    {
      method:'GET',
      headers:{
        'user-agent':'curl/SECRET-AGENT',
        accept:'*/*',
        cookie:'session=TOP-SECRET'
      }
    },
    new URL('https://example.test/private/secret-path?id=SECRET-QUERY'),
    {now,secret:'s'}
  );
  const encoded=JSON.stringify(publicSiteExtraction(p));
  assert.equal(encoded.includes('secret-path'),false);
  assert.equal(encoded.includes('SECRET-QUERY'),false);
  assert.equal(encoded.includes('TOP-SECRET'),false);
  assert.equal(encoded.includes('SECRET-AGENT'),false);
});

test('route family retention is bounded',()=>{
  const p=profile();
  let now=9_000_000;
  for(let i=0;i<120;i++)
  {
    addBehavior(p,i,now,{interval:100});
    observeSiteExtraction(
      p,
      request(`/family-${i}/thing-${i}`),
      new URL(`https://example.test/family-${i}/thing-${i}`),
      {now,secret:'s'}
    );
    now+=100;
  }
  assert.ok(p.siteExtraction.routeFamilyHashes.length<=64);
  assert.ok(p.siteExtraction.minuteBuckets.length<=5);
});

test('bulk-download behavior is visible as supporting extraction evidence',()=>{
  const p=profile();
  p.agentBehavior.downloadResponses=5;
  p.agentBehavior.downloadBytesObserved=25*1024*1024;
  const now=10_000_000;
  for(let i=0;i<20;i++)
  {
    addBehavior(p,i,now+i*1000,{interval:1000});
    observeSiteExtraction(
      p,
      request(`/docs/${i}`),
      new URL(`https://example.test/docs/${i}`),
      {now:now+i*1000,secret:'s'}
    );
  }
  refreshSiteExtraction(p,{now:now+20_000});
  const out=publicSiteExtraction(p);
  assert.ok(out.reasons.some(x=>x.code==='bulk_download_behavior'));
});
