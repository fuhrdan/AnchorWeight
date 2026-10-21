#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION,ANCHORWEIGHT_RELEASE_CHANNEL } from '../src/version.js';
import { createAgentPassport } from '../src/agent-passport.js';
import { observeSiteExtraction,publicSiteExtraction,emptySiteExtraction } from '../src/site-extraction.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FROZEN_SHA256='85ff04b25499e458898f00c6b4b631764efce9b4ee74b11e1078723e29fa956a';
const PROTECTED_BLOBS={
  "src/policy-engine.js": "ef2db82f668f2146073f6ae465dd720b191e7998",
  "src/traffic-scoring.js": "acb9feed6e6a4196ce14d0d90c552330f65077c8",
  "src/resource-budgets.js": "b9f3d7434004e9196142121d06965f4a5fbade08",
  "src/config.js": "d275ba238f0bae518b81d35edcafb09a017bd6f1",
  "src/config-schema.js": "a933cc5fe8a04999ad5b6605b9bb39264eab147a"
};

function sha256(file)
{
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitBlobSha(file)
{
  const data=fs.readFileSync(file);
  return crypto.createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${data.length}\0`),data]))
    .digest('hex');
}

function profile()
{
  return {
    score:0,
    agentBehavior:{
      observations:0,routeHashes:[],minuteBuckets:[],cookieObservations:0,
      noCookieObservations:0,intervalsMs:[],responseObservations:0,
      notFoundResponses:0,downloadResponses:0,downloadBytesObserved:0
    },
    siteExtraction:emptySiteExtraction()
  };
}

function addBehavior(p,i,now,interval=500)
{
  const minute=Math.floor(now/60000);
  let bucket=p.agentBehavior.minuteBuckets[p.agentBehavior.minuteBuckets.length-1];
  if(!bucket || bucket.minute!==minute)
  {
    bucket={minute,routeHashes:[],requests:0,retries:0};
    p.agentBehavior.minuteBuckets.push(bucket);
    if(p.agentBehavior.minuteBuckets.length>5)p.agentBehavior.minuteBuckets.shift();
  }
  p.agentBehavior.observations++;
  const h=`h${i}`;
  p.agentBehavior.routeHashes.push(h);
  if(p.agentBehavior.routeHashes.length>64)p.agentBehavior.routeHashes.shift();
  bucket.requests++;
  bucket.routeHashes.push(h);
  if(p.agentBehavior.observations>1)p.agentBehavior.intervalsMs.push(interval);
  if(p.agentBehavior.intervalsMs.length>32)p.agentBehavior.intervalsMs.shift();
  p.agentBehavior.noCookieObservations++;
}

export function runSiteExtractionCheck({root=ROOT}={})
{
  const failures=[];
  let checks=0;
  const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg);};

  check(['3.2.0-alpha.1','3.2.0-alpha.2'].includes(ANCHORWEIGHT_VERSION),'runtime version must be a supported v3.2 alpha');
  check(ANCHORWEIGHT_RELEASE_CHANNEL==='alpha','release channel must be alpha');

  const frozen=path.join(root,'RC1-FROZEN-CONTRACT.json');
  check(fs.existsSync(frozen)&&sha256(frozen)===FROZEN_SHA256,'frozen v3 contract changed');

  for(const [rel,expected] of Object.entries(PROTECTED_BLOBS))
  {
    const fp=path.join(root,rel);
    check(fs.existsSync(fp)&&gitBlobSha(fp)===expected,`protected enforcement/policy source changed: ${rel}`);
  }

  const moduleSource=fs.readFileSync(path.join(root,'src/site-extraction.js'),'utf8');
  check(moduleSource.includes('observationOnly: true'),'detector must advertise observation-only');
  check(moduleSource.includes('enforcement: false'),'detector must advertise enforcement false');
  check(!moduleSource.includes('shouldQuarantine('),'detector must not call quarantine');
  check(!moduleSource.includes('evaluatePolicyDecision('),'detector must not call Policy Engine');
  check(moduleSource.includes('rawPathRetained: false'),'detector must not retain raw paths');
  check(moduleSource.includes('rawQueryRetained: false'),'detector must not retain raw queries');
  check(moduleSource.includes('rawCookieRetained: false'),'detector must not retain raw cookies');
  check(moduleSource.includes('rawUserAgentRetained: false'),'detector must not retain raw user-agents');

  const one=profile();
  addBehavior(one,0,1_000_000);
  const oneOut=observeSiteExtraction(
    one,
    {method:'GET',headers:{'user-agent':'curl/8.10.0',accept:'*/*'}},
    new URL('https://example.test/'),
    {now:1_000_000,secret:'s'}
  );
  check(oneOut.likelyBulkScrape===false,'single curl request must not be bulk-scrape conviction');
  check(oneOut.score<25,'single curl request must stay below watch threshold');

  const bulk=profile();
  let now=2_000_000;
  for(let i=0;i<45;i++)
  {
    addBehavior(bulk,i,now,500);
    observeSiteExtraction(
      bulk,
      {method:'GET',headers:{'user-agent':'Mozilla/5.0',accept:'text/html'}},
      new URL(`https://example.test/pages/${i}`),
      {now,secret:'s'}
    );
    now+=500;
  }
  const bulkOut=publicSiteExtraction(bulk);
  check(bulkOut.likelyBulkScrape===true,'broad extraction must become likely bulk scrape');
  check(bulkOut.evidence.explicitToolUaRequests===0,'spoofed browser UA case must not depend on curl declaration');
  check(bulk.score===0,'detector must not mutate legacy score');

  const encoded=JSON.stringify(bulkOut);
  check(!encoded.includes('/pages/'),'public detector output must not expose raw paths');

  const passport=createAgentPassport({shadowMode:true});
  const cap=passport.capabilities?.siteExtractionDetection;
  check(cap?.available===true,'Agent Passport site extraction capability missing');
  check(cap?.observationOnly===true,'Agent Passport site extraction must be observation-only');
  check(cap?.enforcement===false,'Agent Passport site extraction must not advertise enforcement');
  check(cap?.rawPathRetained===false && cap?.rawQueryRetained===false &&
        cap?.rawCookieRetained===false && cap?.rawUserAgentRetained===false,
        'Agent Passport site extraction privacy contract changed');

  const behaviorSource=fs.readFileSync(path.join(root,'src/behavior.js'),'utf8');
  check(behaviorSource.includes('observeSiteExtraction(p, req, url'),'request observation wiring missing');
  check(behaviorSource.includes('refreshSiteExtraction(p'),'response refresh wiring missing');
  check(behaviorSource.includes('siteExtraction: emptySiteExtraction()'),'profile state wiring missing');
  check(behaviorSource.includes('siteExtraction: publicSiteExtraction(p)'),'public profile wiring missing');

  const releaseSource=fs.readFileSync(path.join(root,'scripts/release-check.js'),'utf8');
  check(releaseSource.includes('runSiteExtractionCheck'),'release check site-extraction gate missing');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  check(pkg.scripts?.['site-extraction:check']==='node scripts/site-extraction-check.js','package site-extraction gate missing');

  for(const rel of [
    'src/site-extraction.js',
    'scripts/site-extraction-check.js',
    'test/unit/site-extraction.test.js',
    'test/unit/site-extraction-integration.test.js',
    'SITE-EXTRACTION-DETECTION.md',
    'V3.2.0-ALPHA1-RELEASE-NOTES.md'
  ])
    check(fs.existsSync(path.join(root,rel)),`missing v3.2 alpha.1 artifact ${rel}`);

  return {ok:failures.length===0,checks,failures,bulkOut};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
{
  const r=runSiteExtractionCheck();
  if(!r.ok)
  {
    for(const failure of r.failures) console.error('FAIL:',failure);
    process.exit(1);
  }
  console.log(`AnchorWeight ${ANCHORWEIGHT_VERSION} Site Extraction Detection PASS (${r.checks} invariants checked)`);
  console.log('Observation-only: no new blocking, throttling, quarantine, or Policy Engine input.');
  console.log('READY FOR v3.2 alpha shadow evaluation');
}
