import test from 'node:test';
import assert from 'node:assert/strict';
import { nextToken, validateChain } from '../src/procedural.js';
import { MemoryStore } from '../src/store.js';

const secret = 'test-secret';

test('signed path chain validates in sequence', () => {
  const sid = 'abc';
  const t1 = nextToken(secret, sid, 1, '');
  const t2 = nextToken(secret, sid, 2, t1);
  const t3 = nextToken(secret, sid, 3, t2);
  assert.equal(validateChain(secret, sid, [t1,t2,t3]), true);
  assert.equal(validateChain(secret, sid, [t1,'bad',t3]), false);
});

test('MemoryStore expires blocks', () => {
  let now = 1_000;
  const store = new MemoryStore(() => now);
  store.block('ip', 1, 'test');
  assert.ok(store.isBlocked('ip'));
  now += 61_000;
  assert.equal(store.isBlocked('ip'), null);
});

import { createAnchorWeight } from '../src/anchorweight.js';

function mockReq(ip = '203.0.113.10') {
  return { method: 'GET', headers: {}, socket: { remoteAddress: ip } };
}

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 0,
    body: '',
    setHeader(k, v) { headers[k.toLowerCase()] = String(v); },
    end(body = '') { this.body = String(body); }
  };
}

test('quarantined client receives a 200 inert decoy instead of a block error', async () => {
  const config = {
    secret: 'test-secret', basePath: '/anchor', shadowMode: false,
    blockDepth: 3, blockMinutes: 60, repeatBlockMinutes: 1440,
    sessionTtlMinutes: 30, sessionBindIp: true, trustProxy: false,
    dashboardEnabled: false, dashboardToken: '', logFile: '/tmp/anchorweight-test.jsonl',
    branchCount: 7, quarantineMode: 'decoy'
  };
  const store = new MemoryStore();
  const aw = createAnchorWeight(config, { store, log: () => {} });
  const req = mockReq();
  const key = [...store.blocks.keys()][0];
  // Derive the same internal key by creating a lure, then use that session's ipKey.
  const lureRes = mockRes();
  aw.handle(req, lureRes, new URL('http://localhost/anchor/'));
  const session = [...store.sessions.values()][0];
  store.block(session.ipKey, 60, 'test');

  const res = mockRes();
  const handled = await aw.preflight(req, res, new URL('http://localhost/private/account'));
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes('<a '), false);
  assert.equal(res.body.includes('blocked'), false);
  assert.equal(store.stats.quarantinedRequests, 1);
});

import { BehaviorEngine } from '../src/behavior.js';

test('Bot DNA accumulates conservative behavioral signals without raw identifiers', () => {
  const store = new MemoryStore(() => 1000);
  const config = {
    secret: 'dna-secret', scoreUaChange: 10, scoreMissingUa: 5, scoreAutomationUa: 15,
    scoreRapidBurst: 10, rapidRequestMs: 250, rapidRequestBurst: 3,
    scoreLure: 5, scoreTraversal: 20, scoreProofOfCrawl: 40, scoreInvalidTraversal: 8,
    scoreEnforcementEnabled: false, quarantineScore: 100
  };
  const engine = new BehaviorEngine(config, store, () => {}, () => 1000);
  const req = { method: 'GET', headers: { 'user-agent': 'curl/8.0', accept: '*/*' } };
  engine.observeRequest('abcdef1234567890', req, new URL('http://x/'));
  engine.noteLure('abcdef1234567890');
  engine.noteTraversal('abcdef1234567890', 1);
  const profile = store.snapshot().topProfiles[0];
  assert.equal(profile.id, 'AW-ABCDEF12');
  assert.equal(profile.score, 40);
  assert.equal(profile.classification, 'suspicious_automation');
  assert.equal(JSON.stringify(profile).includes('curl/8.0'), false);
});

test('score enforcement can quarantine a high-risk profile when explicitly enabled', async () => {
  const config = {
    secret: 'score-secret', basePath: '/anchor', shadowMode: false,
    blockDepth: 3, blockMinutes: 60, repeatBlockMinutes: 1440,
    sessionTtlMinutes: 30, sessionBindIp: true, trustProxy: false,
    dashboardEnabled: false, dashboardToken: '', logFile: '/tmp/aw-score.jsonl',
    branchCount: 7, quarantineMode: 'decoy', scoreEnforcementEnabled: true,
    quarantineScore: 20, scoreUaChange: 10, scoreMissingUa: 5, scoreAutomationUa: 20,
    scoreRapidBurst: 10, rapidRequestMs: 250, rapidRequestBurst: 6,
    scoreLure: 5, scoreTraversal: 20, scoreProofOfCrawl: 40, scoreInvalidTraversal: 8
  };
  const store = new MemoryStore();
  const aw = createAnchorWeight(config, { store, log: () => {} });
  const req = { method: 'GET', headers: { 'user-agent': 'ExampleCrawler/1.0' }, socket: { remoteAddress: '203.0.113.77' } };
  const res = mockRes();
  const handled = await aw.preflight(req, res, new URL('http://localhost/private'));
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(store.stats.scoreConvictions, 1);
  assert.equal(store.snapshot().activeBlocks, 1);
});

import { GoodBotVerifier } from '../src/goodbot.js';

test('verified Googlebot requires matching reverse and forward DNS', async () => {
  const verifier = new GoodBotVerifier({ goodBotVerificationEnabled: true, goodBotCacheMinutes: 60 }, {
    reverse: async ip => ip === '66.249.66.1' ? ['crawl-66-249-66-1.googlebot.com'] : [],
    lookup: async host => host.endsWith('.googlebot.com') ? [{ address: '66.249.66.1', family: 4 }] : [],
    now: () => 1000
  });
  const good = await verifier.verify('66.249.66.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)');
  assert.equal(good.verified, true);
  assert.equal(good.provider, 'google');
});

test('spoofed Googlebot claim is not trusted when forward DNS does not return source IP', async () => {
  const verifier = new GoodBotVerifier({ goodBotVerificationEnabled: true, goodBotCacheMinutes: 60 }, {
    reverse: async () => ['crawl.example.googlebot.com'],
    lookup: async () => [{ address: '198.51.100.99', family: 4 }],
    now: () => 1000
  });
  const result = await verifier.verify('203.0.113.77', 'Googlebot/2.1');
  assert.equal(result.claimed, true);
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'forward_mismatch');
});

test('verified good bot bypasses score quarantine but spoofed claimant does not', async () => {
  const base = {
    secret: 'goodbot-secret', basePath: '/anchor', shadowMode: false, blockDepth: 3,
    blockMinutes: 60, repeatBlockMinutes: 1440, sessionTtlMinutes: 30, sessionBindIp: true,
    trustProxy: false, dashboardEnabled: false, dashboardToken: '', logFile: '/tmp/aw-goodbot.jsonl',
    branchCount: 7, quarantineMode: 'decoy', scoreEnforcementEnabled: true, quarantineScore: 10,
    scoreUaChange: 10, scoreMissingUa: 5, scoreAutomationUa: 15, scoreRapidBurst: 10,
    rapidRequestMs: 250, rapidRequestBurst: 6, scoreLure: 5, scoreTraversal: 20,
    scoreProofOfCrawl: 40, scoreInvalidTraversal: 8, scoreSpoofedGoodBot: 25,
    goodBotVerificationEnabled: true, goodBotCacheMinutes: 60, allowBotIds: [], quarantineBotIds: []
  };
  const goodBots = { verify: async () => ({ claimed: true, verified: true, provider: 'google' }) };
  const store = new MemoryStore();
  const aw = createAnchorWeight(base, { store, log: () => {}, goodBots });
  const req = { method: 'GET', headers: { 'user-agent': 'Googlebot/2.1' }, socket: { remoteAddress: '66.249.66.1' } };
  const res = mockRes();
  assert.equal(await aw.preflight(req, res, new URL('http://localhost/page')), false);
  assert.equal(store.snapshot().activeBlocks, 0);
  assert.equal(store.snapshot().verifiedGoodBots, 1);
});

import { parseStartFlags } from '../src/cli-options.js';

test('CLI start flags map to environment configuration safely', () => {
  const env = parseStartFlags(['--proxy', '--origin', 'http://127.0.0.1:9000', '--enforce', '--block-depth', '3', '--trust-proxy']);
  assert.equal(env.AW_PROXY_ENABLED, 'true');
  assert.equal(env.AW_ORIGIN_URL, 'http://127.0.0.1:9000');
  assert.equal(env.AW_SHADOW_MODE, 'false');
  assert.equal(env.AW_BLOCK_DEPTH, '3');
  assert.equal(env.AW_TRUST_PROXY, 'true');
});

test('CLI rejects unknown flags and missing flag values', () => {
  assert.throws(() => parseStartFlags(['--wat']), /Unknown flag/);
  assert.throws(() => parseStartFlags(['--origin']), /requires a value/);
});


test('Bot DNA infers depth-first traversal style across a signed session', () => {
  const store = new MemoryStore(() => 1000);
  const config = { secret:'style', scoreTraversal:20 };
  const engine = new BehaviorEngine(config, store, () => {}, () => 1000);
  engine.noteTraversal('abcdef1234567890', 1, 's1');
  engine.noteTraversal('abcdef1234567890', 2, 's1');
  assert.equal(store.snapshot().topProfiles[0].traversalStyle, 'depth_first');
});

test('cross-IP use of an issued signed canary creates a campaign correlation', async () => {
  const config = { secret:'campaign-secret', basePath:'/anchor', shadowMode:true, blockDepth:3, blockMinutes:60, repeatBlockMinutes:1440, sessionTtlMinutes:30, sessionBindIp:true, trustProxy:false, dashboardEnabled:false, dashboardToken:'', logFile:'/tmp/aw-campaign.jsonl', branchCount:7, quarantineMode:'decoy', scoreEnforcementEnabled:false, quarantineScore:100, scoreUaChange:10, scoreMissingUa:5, scoreAutomationUa:15, scoreRapidBurst:10, rapidRequestMs:250, rapidRequestBurst:6, scoreLure:5, scoreTraversal:20, scoreProofOfCrawl:40, scoreInvalidTraversal:8, scoreSpoofedGoodBot:25, scoreSharedCanary:20, goodBotVerificationEnabled:false, allowBotIds:[], quarantineBotIds:[] };
  const store = new MemoryStore();
  const aw = createAnchorWeight(config, { store, log:()=>{}, goodBots:{verify:async()=>({claimed:false,verified:false})} });
  const owner = mockReq('203.0.113.10'); const lure = mockRes();
  aw.handle(owner, lure, new URL('http://localhost/anchor/'));
  const href = lure.body.match(/href="([^"]+)"/)[1];
  const other = mockReq('198.51.100.22'); const res=mockRes();
  aw.handle(other, res, new URL('http://localhost'+href));
  const snap=store.snapshot();
  assert.equal(snap.trackedCampaigns,1);
  assert.equal(snap.topCampaigns[0].memberCount,2);
  assert.equal(snap.topCampaigns[0].evidence.at(-1).reason,'shared_signed_canary');
});


test('v0.7 operator policy can be set and cleared by public Bot DNA ID', () => {
  const store = new MemoryStore();
  const key = 'abcdef1234567890abcdef';
  store.getProfile(key).score = 55;
  const set = store.setManualPolicyById('AW-ABCDEF12', 'quarantine');
  assert.equal(set.manualPolicy, 'quarantine');
  assert.equal(store.getPublicProfileById('AW-ABCDEF12').classification, 'manually_quarantined');
  const cleared = store.setManualPolicyById('AW-ABCDEF12', null);
  assert.equal(cleared.manualPolicy, null);
});

test('v0.7 event reader redacts keyed IP identity and supports Bot DNA filtering', async () => {
  const { readEvents } = await import('../src/logger.js');
  const fs = await import('node:fs');
  const file = `/tmp/aw-events-${process.pid}-${Date.now()}.jsonl`;
  fs.writeFileSync(file, [
    JSON.stringify({ts:'2026-09-05T12:00:00Z',type:'lure',ipKey:'abcdef1234567890',sid:'s1'}),
    JSON.stringify({ts:'2026-09-05T12:00:01Z',type:'traversal',ipKey:'abcdef1234567890',depth:1}),
    JSON.stringify({ts:'2026-09-05T12:00:02Z',type:'lure',ipKey:'99999999aaaa',sid:'s2'})
  ].join('\n')+'\n');
  const events = readEvents(file,{botId:'AW-ABCDEF12',limit:10});
  assert.equal(events.length,2);
  assert.equal(events[0].botId,'AW-ABCDEF12');
  assert.equal('ipKey' in events[0],false);
  fs.unlinkSync(file);
});


test('v0.8 CLI maps operations-maturity profile and retention flags', () => {
  const env = parseStartFlags(['--profile','shadow','--event-retention-days','14','--event-max-mb','25']);
  assert.equal(env.AW_PROFILE,'shadow');
  assert.equal(env.AW_EVENT_RETENTION_DAYS,'14');
  assert.equal(env.AW_EVENT_MAX_MB,'25');
});

test('v0.8 backup, report, prune, and restore operate on bounded local files', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { backupFiles, restoreFiles, exportEvidence, pruneEvents } = await import('../src/ops.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-ops-'));
  const state=path.join(dir,'state.json'), log=path.join(dir,'events.jsonl');
  fs.writeFileSync(state,JSON.stringify({blocks:[['x',{until:999}]],profiles:[],campaigns:[]}));
  fs.writeFileSync(log,[
    JSON.stringify({ts:'2020-01-01T00:00:00Z',type:'old'}),
    JSON.stringify({ts:new Date().toISOString(),type:'new'})
  ].join('\n')+'\n');
  const config={stateFile:state,logFile:log,eventRetentionDays:30,profileName:'test'};
  const backup=await backupFiles(config,path.join(dir,'backups'));
  assert.equal(fs.existsSync(path.join(backup.dir,'manifest.json')),true);
  const report=await exportEvidence(config,path.join(dir,'report.json'));
  assert.equal(report.summary.events,2);
  const pruned=pruneEvents(config);
  assert.equal(pruned.removed,1);
  fs.writeFileSync(state,'{}');
  restoreFiles(config,backup.dir);
  const restored=JSON.parse(fs.readFileSync(state,'utf8'));
  assert.equal(restored.blocks.length,1);
  fs.rmSync(dir,{recursive:true,force:true});
});


test('v0.9 admin security requires authenticated CSRF session and rate limits admin surface', async () => {
  const { AdminSecurity } = await import('../src/admin-security.js');
  const admin = new AdminSecurity({
    secret:'admin-secret', dashboardToken:'dashboard-token',
    allowQueryAdminToken:false, adminRateLimitPerMinute:2, csrfTtlMinutes:15
  }, () => 1000);
  const req = { headers:{authorization:'Bearer dashboard-token'}, socket:{remoteAddress:'203.0.113.10'} };
  const url = new URL('http://localhost/anchor/api/stats?token=wrong');
  assert.equal(admin.authenticate(req,url,(a,b)=>a===b),true);
  const noBearer={headers:{},socket:{remoteAddress:'203.0.113.10'}};
  const queryOnly=new URL('http://localhost/anchor/api/stats?token=dashboard-token');
  assert.equal(admin.authenticate(noBearer,queryOnly,(a,b)=>a===b),false);
  const csrf=admin.issueCsrf(req);
  assert.equal(admin.validateCsrf({...req,headers:{...req.headers,'x-aw-csrf':csrf}}),true);
  assert.equal(admin.rateLimit(req,'authenticated').allowed,true);
  assert.equal(admin.rateLimit(req,'authenticated').allowed,true);
  assert.equal(admin.rateLimit(req,'authenticated').allowed,false);
  assert.equal(admin.rateLimit(req,'failed_auth').allowed,true);
});

test('v0.9 persisted operator policy survives subsequent preflight requests', async () => {
  const config = {
    secret:'policy-secret', basePath:'/anchor', shadowMode:true, blockDepth:3,
    blockMinutes:60, repeatBlockMinutes:1440, sessionTtlMinutes:30, sessionBindIp:true,
    trustProxy:false, dashboardEnabled:false, dashboardToken:'', logFile:'/tmp/aw-policy.jsonl',
    auditLogFile:'/tmp/aw-policy-audit.jsonl', branchCount:7, quarantineMode:'decoy',
    scoreEnforcementEnabled:false, quarantineScore:100, scoreUaChange:10, scoreMissingUa:5,
    scoreAutomationUa:15, scoreRapidBurst:10, rapidRequestMs:250, rapidRequestBurst:6,
    scoreLure:5, scoreTraversal:20, scoreProofOfCrawl:40, scoreInvalidTraversal:8,
    scoreSpoofedGoodBot:25, scoreSharedCanary:20, goodBotVerificationEnabled:false,
    allowBotIds:[], quarantineBotIds:[], adminRateLimitPerMinute:60
  };
  const store=new MemoryStore();
  const aw=createAnchorWeight(config,{store,log:()=>{},audit:()=>{},goodBots:{verify:async()=>({claimed:false,verified:false})}});
  const req=mockReq('203.0.113.88');
  await aw.preflight(req,mockRes(),new URL('http://localhost/page'));
  const profile=store.snapshot().topProfiles[0];
  store.setManualPolicyById(profile.id,'allow');
  await aw.preflight(req,mockRes(),new URL('http://localhost/page2'));
  assert.equal(store.getPublicProfileById(profile.id).manualPolicy,'allow');
});

test('v0.9 reverse proxy rejects credentials in origin URL', async () => {
  const { createReverseProxy } = await import('../src/proxy.js');
  assert.throws(() => createReverseProxy({
    originUrl:'http://user:pass@127.0.0.1:8081',
    proxyBodyMaxBytes:1024, proxyTimeoutMs:1000, publicScheme:'https', trustProxy:false
  }), /must not contain credentials/);
});

test('v0.9 CLI maps production-hardening flags', () => {
  const env=parseStartFlags([
    '--admin-rate-limit','80','--admin-body-max-bytes','4096',
    '--proxy-body-max-bytes','1048576','--shutdown-grace-ms','5000',
    '--no-query-admin-token','--readiness-origin-check'
  ]);
  assert.equal(env.AW_ADMIN_RATE_LIMIT_PER_MINUTE,'80');
  assert.equal(env.AW_ADMIN_BODY_MAX_BYTES,'4096');
  assert.equal(env.AW_PROXY_BODY_MAX_BYTES,'1048576');
  assert.equal(env.AW_SHUTDOWN_GRACE_MS,'5000');
  assert.equal(env.AW_ALLOW_QUERY_ADMIN_TOKEN,'false');
  assert.equal(env.AW_READINESS_ORIGIN_CHECK,'true');
});
