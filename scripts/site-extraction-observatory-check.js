#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { buildSiteExtractionObservatory } from '../src/site-extraction-observatory.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function sample(id,score,level)
{
  return {
    id,
    siteExtraction:{
      score,level,observations:40,lastAt:Date.now(),
      likelyBulkScrape:score>=60,
      highConfidenceBulkScrape:score>=80,
      evidence:{
        routeBreadth:40,routeBreadth5m:40,uniqueUrlsCurrentMinute:25,
        requestsCurrentMinute:30,routeFamilyCount:4,notFoundPercent:5,
        downloadResponses:0,downloadBytesObserved:0
      },
      reasons:[{code:'high_unique_url_breadth',points:20}]
    }
  };
}

export function runSiteExtractionObservatoryCheck({root=ROOT}={})
{
  const failures=[];
  let checks=0;
  const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};

  check(['3.2.0-alpha.2','3.2.0-alpha.3','3.2.0-alpha.4'].includes(ANCHORWEIGHT_VERSION),'runtime version must be a supported Site Extraction Observatory v3.2 alpha');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='alpha','release channel must remain alpha');

  const out=buildSiteExtractionObservatory([
    sample('AW-NONE',10,'none'),
    sample('AW-LIKELY',66,'likely_bulk_scrape'),
    sample('AW-HIGH',86,'high_confidence_bulk_scrape')
  ]);

  check(out.observationOnly===true,'observatory must be observation-only');
  check(out.enforcement===false,'observatory must not advertise enforcement');
  check(out.topCandidates?.[0]?.id==='AW-HIGH','highest score must rank first');
  check(out.likelyBulkScrape===2,'likely count must include high-confidence candidates');
  check(out.highConfidenceBulkScrape===1,'high-confidence count mismatch');
  check(out.thresholds?.likelyBulkScrape===60,'likely threshold changed unexpectedly');
  check(out.thresholds?.highConfidenceBulkScrape===80,'high-confidence threshold changed unexpectedly');
  check(out.privacy?.rawPathRetained===false,'raw path privacy contract changed');
  check(out.privacy?.rawQueryRetained===false,'raw query privacy contract changed');
  check(out.privacy?.rawCookieRetained===false,'raw cookie privacy contract changed');
  check(out.privacy?.rawUserAgentRetained===false,'raw User-Agent privacy contract changed');
  check(out.privacy?.rawIpRetained===false,'raw IP privacy contract changed');
  check(out.privacy?.routeFamilyHashesExposed===false,'route family hashes must not be exposed');

  const anchorSource=fs.readFileSync(path.join(root,'src/anchorweight.js'),'utf8');
  check(anchorSource.includes("buildSiteExtractionObservatory"),'stats observatory wiring missing');
  check(anchorSource.includes("siteExtractionObservatory"),'stats response field missing');

  const dashboard=fs.readFileSync(path.join(root,'public/dashboard.html'),'utf8');
  check(dashboard.includes('Site Extraction Observatory'),'dashboard panel missing');
  check(dashboard.includes('renderSiteExtractionObservatory'),'dashboard renderer missing');
  check(dashboard.includes('j.siteExtractionObservatory'),'dashboard stats wiring missing');

  return {ok:failures.length===0,checks,failures};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
{
  const r=runSiteExtractionObservatoryCheck();
  if(!r.ok)
  {
    for(const failure of r.failures) console.error('FAIL:',failure);
    process.exit(1);
  }
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} Site Extraction Observatory PASS (${r.checks} invariants checked)`);
  console.log('Observation-only: no blocking, throttling, quarantine, decoy, Policy Engine, or Resource Budget changes.');
  console.log('READY FOR v3.2 alpha shadow deployment');
}
