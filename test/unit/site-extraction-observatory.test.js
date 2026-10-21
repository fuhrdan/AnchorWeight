import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteExtractionObservatory } from '../../src/site-extraction-observatory.js';

function p(id, score, level, extra = {})
{
  return {
    id,
    siteExtraction: {
      score,
      level,
      observations: extra.observations ?? 20,
      lastAt: extra.lastAt ?? 1_000_000,
      likelyBulkScrape: score >= 60,
      highConfidenceBulkScrape: score >= 80,
      evidence: {
        routeBreadth: extra.routeBreadth ?? 20,
        routeBreadth5m: extra.routeBreadth5m ?? 20,
        uniqueUrlsCurrentMinute: extra.uniqueUrlsCurrentMinute ?? 10,
        requestsCurrentMinute: extra.requestsCurrentMinute ?? 12,
        routeFamilyCount: extra.routeFamilyCount ?? 4,
        notFoundPercent: extra.notFoundPercent ?? 0,
        downloadResponses: extra.downloadResponses ?? 0,
        downloadBytesObserved: extra.downloadBytesObserved ?? 0
      },
      reasons: extra.reasons ?? [{code:'high_unique_url_breadth',points:20}],
      privacy: {
        rawPathRetained:false,
        rawQueryRetained:false,
        rawCookieRetained:false,
        rawUserAgentRetained:false
      }
    }
  };
}

test('observatory ranks highest extraction candidates first',()=>{
  const out=buildSiteExtractionObservatory([
    p('AW-LOW',20,'none'),
    p('AW-LIKELY',67,'likely_bulk_scrape'),
    p('AW-HIGH',88,'high_confidence_bulk_scrape')
  ],{now:1_000_100});
  assert.equal(out.topCandidates[0].id,'AW-HIGH');
  assert.equal(out.topCandidates[1].id,'AW-LIKELY');
  assert.equal(out.likelyBulkScrape,2);
  assert.equal(out.highConfidenceBulkScrape,1);
  assert.equal(out.enforcement,false);
  assert.equal(out.observationOnly,true);
});

test('observatory exposes bounded level and reason aggregates',()=>{
  const out=buildSiteExtractionObservatory([
    p('AW-A',48,'elevated',{reasons:[{code:'broad_unique_content_walk',points:12}]}),
    p('AW-B',30,'watch',{reasons:[{code:'broad_unique_content_walk',points:12},{code:'minimal_cookie_continuity',points:10}]})
  ],{now:1_000_100});
  assert.equal(out.levels.elevated,1);
  assert.equal(out.levels.watch,1);
  assert.equal(out.topReasons.broad_unique_content_walk,2);
  assert.equal(out.topReasons.minimal_cookie_continuity,1);
});

test('observatory marks only fresh profiles as recent',()=>{
  const out=buildSiteExtractionObservatory([
    p('AW-RECENT',30,'watch',{lastAt:1_000_000}),
    p('AW-STALE',30,'watch',{lastAt:600_000})
  ],{now:1_100_000});
  assert.equal(out.recentProfiles,1);
});

test('observatory output never contains raw request identity fields',()=>{
  const out=buildSiteExtractionObservatory([
    p('AW-PRIVATE',75,'likely_bulk_scrape')
  ],{now:1_000_100});
  const encoded=JSON.stringify(out);
  for(const forbidden of ['rawPath','rawQuery','rawCookie','rawUserAgent','routeFamilyHashes'])
    assert.equal(encoded.includes(`"${forbidden}":`),false);
  assert.equal(out.privacy.rawIpRetained,false);
  assert.equal(out.privacy.routeFamilyHashesExposed,false);
});

test('candidate output is capped',()=>{
  const rows=Array.from({length:40},(_,i)=>p(`AW-${String(i).padStart(2,'0')}`,100-i,'high_confidence_bulk_scrape'));
  const out=buildSiteExtractionObservatory(rows,{now:1_000_100,limit:12});
  assert.equal(out.topCandidates.length,12);
});
