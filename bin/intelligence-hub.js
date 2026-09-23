#!/usr/bin/env node
/** Run as a SEPARATE Node app from the existing site sensor. */
import fs from 'node:fs';
import { createIntelligenceHub } from '../src/intelligence-hub.js';
const port = Number(process.env.PORT || 8082);
const siteFile = process.env.AW_HUB_SITES_FILE || './data/intelligence-sites.json';
try {
  const sites = JSON.parse(fs.readFileSync(siteFile,'utf8'));
  const {server} = createIntelligenceHub({sites,file:process.env.AW_HUB_STATE_FILE || './data/intelligence-events.jsonl',
    adminToken:process.env.AW_HUB_ADMIN_TOKEN});
  server.listen(port,()=>console.log(`AnchorWeight intelligence hub v2.1.0 listening on :${port}`));
} catch (err) { console.error('[AnchorWeight hub] startup failed:',err.message); process.exitCode=1; }
