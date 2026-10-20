import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAgentPassport } from '../../src/agent-passport.js';

const root=path.resolve(new URL('../..',import.meta.url).pathname);

test('v3.2 alpha.1 runtime wiring observes and exposes site extraction without policy coupling',()=>{
  const behavior=fs.readFileSync(path.join(root,'src/behavior.js'),'utf8');
  assert.match(behavior,/observeSiteExtraction\(p, req, url/);
  assert.match(behavior,/refreshSiteExtraction\(p/);
  assert.match(behavior,/siteExtraction: emptySiteExtraction\(\)/);
  assert.match(behavior,/siteExtraction: publicSiteExtraction\(p\)/);
  assert.doesNotMatch(behavior,/siteExtraction.*policyDecision/);
});

test('Agent Passport advertises observation-only site extraction capability',()=>{
  const p=createAgentPassport({shadowMode:true});
  const c=p.capabilities.siteExtractionDetection;
  assert.equal(c.available,true);
  assert.equal(c.observationOnly,true);
  assert.equal(c.enforcement,false);
  assert.equal(c.rawPathRetained,false);
  assert.equal(c.rawQueryRetained,false);
  assert.equal(c.rawCookieRetained,false);
  assert.equal(c.rawUserAgentRetained,false);
});
