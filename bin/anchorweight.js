#!/usr/bin/env node
import process from 'node:process';
import { parseStartFlags } from '../src/cli-options.js';
import { loadConfig } from '../src/config.js';
import { backupFiles, restoreFiles, exportEvidence, pruneEvents, inspectState, inspectConfiguredState, migrateStateFile } from '../src/ops.js';
import { validateConfig } from '../src/config-schema.js';

const VERSION = '1.6.0';
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'start';

function usage() {
  console.log(`AnchorWeight v${VERSION}\n\nUsage:\n  anchorweight <command> [flags]\n\nCommands:\n  start            Start AnchorWeight (default command)\n  check            Validate the effective configuration\n  config           Print the effective configuration (secrets redacted)\n  status           Query a running AnchorWeight instance\n  profiles         Show the highest-risk Bot DNA profiles\n  campaigns        Show correlated distributed crawler campaigns\n  events           Show/filter recent investigation events\n  investigate      Show one Bot DNA/campaign investigation timeline\n  policy           Set/clear an operator policy for a Bot DNA ID\n  trap-test        Walk the signed trap chain against a running instance\n  doctor           Diagnose config, running instance, dashboard, and origin\n  profile-list     List built-in/named configuration profiles\n  backup           Back up state and evidence files\n  restore          Restore a backup directory\n  report           Export a JSON evidence report\n  prune            Apply event retention immediately\n  state-check      Inspect persisted state compatibility\n  migrate          Migrate persisted state to the v1 schema\n  release-check    Run v1 release/config/state readiness checks\n  help             Show this help\n  version          Print the version\n\nStart flags:\n  --port <n>                    Listen port\n  --origin <url>                Real website origin URL\n  --proxy / --no-proxy          Enable/disable whole-site reverse proxy\n  --shadow / --enforce          Observe only / enable quarantine\n  --base-path <path>            Trap base path (default /anchor)\n  --dashboard-token <token>     Dashboard/API token\n  --block-depth <2-8>           Proof-of-Crawl depth\n  --block-minutes <n>           First quarantine duration\n  --repeat-block-minutes <n>    Repeat quarantine duration\n  --score-enforcement           Enable score-based quarantine\n  --no-score-enforcement        Disable score-based quarantine\n  --quarantine-score <n>        Score threshold for quarantine\n  --trust-proxy                 Trust X-Forwarded-For from your proxy\n  --no-trust-proxy              Ignore X-Forwarded-For\n  --public-scheme <http|https>  Public URL scheme\n  --proxy-timeout-ms <n>        Origin request timeout\n  --dashboard / --no-dashboard Enable/disable dashboard\n  --good-bot-verification       Verify supported search bots\n  --no-good-bot-verification    Disable good-bot verification\n  --profile <name>               Load config/profiles/<name>.json\n  --event-retention-days <n>     Keep rotated/event evidence for N days\n  --event-max-mb <n>             Rotate active JSONL log near this size
  --admin-rate-limit <n>          Admin API requests/minute per client
  --admin-body-max-bytes <n>      Maximum admin mutation body size
  --proxy-body-max-bytes <n>      Maximum proxied request body size
  --shutdown-grace-ms <n>         Graceful shutdown deadline
  --no-query-admin-token          Reject admin credentials in URLs (default)
  --allow-query-admin-token       Legacy compatibility; not recommended
  --readiness-origin-check        Include origin in /ready checks
  --no-readiness-origin-check     Do not probe origin from /ready
\nRemote command flags:\n  --url <url>        AnchorWeight base URL, e.g. http://127.0.0.1:8080\n  --token <token>    Dashboard/API token\n\nExamples:\n  anchorweight start --proxy --origin http://127.0.0.1:8081 --shadow\n  anchorweight start --proxy --origin http://127.0.0.1:8081 --enforce --block-depth 3\n  anchorweight check --proxy --origin http://127.0.0.1:8081 --enforce\n  anchorweight status --url http://127.0.0.1:8080 --token YOUR_TOKEN\n  anchorweight profiles --url http://127.0.0.1:8080 --token YOUR_TOKEN\n  anchorweight campaigns --url http://127.0.0.1:8080 --token YOUR_TOKEN\n  anchorweight events --url http://127.0.0.1:8080 --token YOUR_TOKEN --limit 50\n  anchorweight investigate --url http://127.0.0.1:8080 --token YOUR_TOKEN --bot AW-1234ABCD\n  anchorweight policy --url http://127.0.0.1:8080 --token YOUR_TOKEN --bot AW-1234ABCD --quarantine\n  anchorweight trap-test --url http://127.0.0.1:8080\n  anchorweight doctor --profile shadow --origin http://127.0.0.1:8081\n  anchorweight backup --profile production --dest ./backups\n  anchorweight report --profile production --out ./reports/evidence.json\n  anchorweight state-check --profile production\n  anchorweight migrate --profile production --dry-run\n  anchorweight release-check --profile production\n`);
}

function remoteArgs(argv) {
  let url = 'http://127.0.0.1:8080';
  let token = process.env.AW_DASHBOARD_TOKEN || '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') url = argv[++i];
    else if (argv[i] === '--token') token = argv[++i];
    else throw new Error(`Unknown flag: ${argv[i]}`);
  }
  return { url: url.replace(/\/$/, ''), token };
}

function redactedConfig(c) {
  return {
    version: VERSION,
    configSchemaVersion: 1,
    profile: c.profileName || null,
    port: c.port,
    basePath: c.basePath,
    mode: c.shadowMode ? 'shadow' : 'enforce',
    proxyEnabled: c.proxyEnabled,
    originUrl: c.originUrl,
    trustProxy: c.trustProxy,
    blockDepth: c.blockDepth,
    blockMinutes: c.blockMinutes,
    repeatBlockMinutes: c.repeatBlockMinutes,
    scoreEnforcementEnabled: c.scoreEnforcementEnabled,
    quarantineScore: c.quarantineScore,
    dashboardEnabled: c.dashboardEnabled,
    dashboardToken: c.dashboardToken ? '[set]' : '[not set]',
    goodBotVerificationEnabled: c.goodBotVerificationEnabled,
    stateFile: c.stateFile,
    stateBackend: c.stateBackend,
    sqliteFile: c.sqliteFile,
    logFile: c.logFile,
    eventRetentionDays: c.eventRetentionDays,
    eventMaxMb: c.eventMaxMb,
    adminRateLimitPerMinute: c.adminRateLimitPerMinute,
    adminBodyMaxBytes: c.adminBodyMaxBytes,
    proxyBodyMaxBytes: c.proxyBodyMaxBytes,
    allowQueryAdminToken: c.allowQueryAdminToken,
    auditEnabled: c.auditEnabled,
    auditLogFile: c.auditLogFile,
    readinessOriginCheck: c.readinessOriginCheck,
    shutdownGraceMs: c.shutdownGraceMs,
    secret: process.env.AW_SECRET ? '[set]' : '[ephemeral - set AW_SECRET for production]'
  };
}

function validate(c) {
  const warnings = [];
  const errors = [];
  if (c.proxyEnabled) {
    try { new URL(c.originUrl); } catch { errors.push('AW_ORIGIN_URL / --origin is not a valid URL.'); }
  }
  if (!c.shadowMode && !process.env.AW_SECRET) warnings.push('Enforcement is enabled but AW_SECRET is not persistent; set AW_SECRET before production use.');
  if (c.dashboardEnabled && !c.dashboardToken) warnings.push('Dashboard is enabled but AW_DASHBOARD_TOKEN is empty; stats API will reject all requests.');
  if (c.trustProxy) warnings.push('AW_TRUST_PROXY is enabled. Only use this behind a trusted reverse proxy that overwrites X-Forwarded-For.');
  if (!c.proxyEnabled) warnings.push('Whole-site proxy is disabled; AnchorWeight can only protect requests routed directly to it.');
  if (c.allowQueryAdminToken) warnings.push('AW_ALLOW_QUERY_ADMIN_TOKEN is enabled. Bearer tokens in URLs can leak through history and logs; disable for production.');
  if (c.proxyEnabled) {
    try {
      const u=new URL(c.originUrl);
      if (!['http:','https:'].includes(u.protocol)) errors.push('Origin must use http:// or https://.');
      if (u.username || u.password) errors.push('Origin URL must not contain credentials.');
      if (u.search || u.hash) errors.push('Origin URL must not contain query strings or fragments.');
    } catch {}
  }
  return { errors, warnings };
}

async function fetchStats(argv) {
  const { url, token } = remoteArgs(argv);
  if (!token) throw new Error('A dashboard token is required (--token or AW_DASHBOARD_TOKEN).');
  const health = await fetch(`${url}/health`);
  if (!health.ok) throw new Error(`Health endpoint returned HTTP ${health.status}`);
  const h = await health.json();
  const basePath = h.basePath || '/anchor';
  const stats = await fetch(`${url}${basePath}/api/stats`, { headers: { Authorization: `Bearer ${token}` } });
  if (!stats.ok) throw new Error(`Stats endpoint returned HTTP ${stats.status}`);
  return { health: h, stats: await stats.json(), url };
}


function investigationArgs(argv) {
  let url = 'http://127.0.0.1:8080', token = process.env.AW_DASHBOARD_TOKEN || '';
  let limit = 50, type = '', bot = '', campaign = '', q = '', policy = undefined;
  for (let i=0;i<argv.length;i++) {
    const a=argv[i];
    if (a==='--url') url=argv[++i];
    else if (a==='--token') token=argv[++i];
    else if (a==='--limit') limit=Number(argv[++i] || 50);
    else if (a==='--type') type=argv[++i] || '';
    else if (a==='--bot') bot=argv[++i] || '';
    else if (a==='--campaign') campaign=argv[++i] || '';
    else if (a==='--search') q=argv[++i] || '';
    else if (a==='--allow') policy='allow';
    else if (a==='--quarantine') policy='quarantine';
    else if (a==='--clear') policy=null;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return {url:url.replace(/\/$/,''),token,limit,type,bot,campaign,q,policy};
}

async function apiCall(argv, path, options={}) {
  const a=investigationArgs(argv);
  if (!a.token) throw new Error('A dashboard token is required (--token or AW_DASHBOARD_TOKEN).');
  const health=await fetch(`${a.url}/health`); if(!health.ok) throw new Error(`Health endpoint returned HTTP ${health.status}`);
  const h=await health.json(); const base=h.basePath||'/anchor';
  const r=await fetch(`${a.url}${base}${path(a)}`, { ...options, headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json',...(options.headers||{})} });
  if(!r.ok) throw new Error(`API returned HTTP ${r.status}: ${await r.text()}`);
  return {data:await r.json(),args:a};
}


async function getCsrf(argv) {
  const a=investigationArgs(argv);
  if(!a.token) throw new Error('A dashboard token is required (--token or AW_DASHBOARD_TOKEN).');
  const health=await fetch(`${a.url}/health`);
  if(!health.ok) throw new Error(`Health endpoint returned HTTP ${health.status}`);
  const h=await health.json();
  const base=h.basePath||'/anchor';
  const r=await fetch(`${a.url}${base}/api/session`,{headers:{Authorization:`Bearer ${a.token}`}});
  if(!r.ok) throw new Error(`Admin session endpoint returned HTTP ${r.status}`);
  const j=await r.json();
  return {csrfToken:j.csrfToken,base,args:a};
}

async function trapTest(argv) {
  const { url } = remoteArgs(argv.filter((v, i, a) => v !== '--token' && a[i - 1] !== '--token'));
  const healthRes = await fetch(`${url}/health`);
  if (!healthRes.ok) throw new Error(`Health endpoint returned HTTP ${healthRes.status}`);
  const health = await healthRes.json();
  const base = health.basePath || '/anchor';
  let next = `${url}${base}/`;
  const max = health.blockDepth || 3;
  console.log(`Walking trap at ${next} (up to ${max} levels)`);
  for (let depth = 0; depth <= max; depth++) {
    const r = await fetch(next, { redirect: 'manual', headers: { 'User-Agent': 'AnchorWeight-CLI-Trap-Test/1.6.0' } });
    const body = await r.text();
    console.log(`  depth ${depth}: HTTP ${r.status} ${new URL(next).pathname}`);
    if (depth >= max) break;
    const match = body.match(/href="([^"]+)"/i);
    if (!match) throw new Error(`No child link found at depth ${depth}; trap may be disabled or client may already be trusted/quarantined.`);
    next = new URL(match[1], next).toString();
  }
  console.log('Trap traversal completed. In Shadow Mode this is recorded only; in enforce mode this CLI client may now be quarantined.');
}


function localOpsArgs(argv) {
  const startArgs=[]; let dest='', source='', out='';
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--dest') dest=argv[++i]||'';
    else if(a==='--source') source=argv[++i]||'';
    else if(a==='--out') out=argv[++i]||'';
    else startArgs.push(a);
  }
  return {startArgs,dest,source,out};
}

async function doctor(argv) {
  let remoteUrl='', remoteToken=process.env.AW_DASHBOARD_TOKEN||'';
  const startArgs=[];
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--url') remoteUrl=argv[++i]||'';
    else if(argv[i]==='--token') remoteToken=argv[++i]||'';
    else startArgs.push(argv[i]);
  }
  const env=parseStartFlags(startArgs);
  Object.assign(process.env,env);
  const c=loadConfig();
  const checks=[];
  const add=(name,ok,detail)=>checks.push({Check:name,Status:ok?'PASS':'FAIL',Detail:detail});
  const v=validate(c);
  add('Configuration',v.errors.length===0,v.errors.join('; ')||`valid${c.profileName?` (profile ${c.profileName})`:''}`);
  add('Persistent secret',!!process.env.AW_SECRET,process.env.AW_SECRET?'configured':'AW_SECRET is ephemeral');
  add('Dashboard token',!c.dashboardEnabled||!!c.dashboardToken,c.dashboardEnabled?(c.dashboardToken?'configured':'missing'):'dashboard disabled');
  for (const [name,file] of [['State path',c.stateFile],['Event path',c.logFile]]) {
    try {
      const dir=(await import('node:path')).dirname(file);
      (await import('node:fs')).mkdirSync(dir,{recursive:true});
      (await import('node:fs')).accessSync(dir,(await import('node:fs')).constants.W_OK);
      add(name,true,`${dir} writable`);
    } catch(e){add(name,false,e.message)}
  }
  if(c.proxyEnabled){
    try{
      const r=await fetch(c.originUrl,{method:'HEAD',signal:AbortSignal.timeout(Math.min(c.proxyTimeoutMs,5000))});
      add('Origin reachability',r.status<600,`${c.originUrl} -> HTTP ${r.status}`);
    }catch(e){add('Origin reachability',false,`${c.originUrl} -> ${e.message}`)}
  } else add('Origin reachability',true,'proxy disabled; skipped');

  if(remoteUrl){
    try{
      const base=remoteUrl.replace(/\/$/,'');
      const r=await fetch(`${base}/live`,{signal:AbortSignal.timeout(5000)});
      const h=await r.json();
      add('Liveness',r.ok&&h.ok,`${base}/live -> HTTP ${r.status}, v${h.version||'?'}`);
      const ready=await fetch(`${base}/ready`,{signal:AbortSignal.timeout(5000)});
      let readyBody={}; try{readyBody=await ready.json()}catch{}
      add('Readiness',ready.ok&&readyBody.ok,`${base}/ready -> HTTP ${ready.status}${readyBody.origin?.detail?`, origin ${readyBody.origin.detail}`:''}`);
      if(remoteToken&&h.basePath){
        const st=await fetch(`${base}${h.basePath}/api/stats`,{headers:{Authorization:`Bearer ${remoteToken}`},signal:AbortSignal.timeout(5000)});
        add('Dashboard/API auth',st.ok,`HTTP ${st.status}`);
      } else if(c.dashboardEnabled) add('Dashboard/API auth',false,'provide --token to verify authenticated API');
    }catch(e){add('Liveness',false,e.message)}
  } else add('Liveness',true,'not requested; use --url to test a live instance');

  console.table(checks);
  for(const w of v.warnings) console.log(`WARNING: ${w}`);
  return checks.some(x=>x.Status==='FAIL')?1:0;
}


function stateCommandArgs(argv) {
  const startArgs=[]; let stateFile='', dryRun=false;
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--state') stateFile=argv[++i]||'';
    else if(a==='--dry-run') dryRun=true;
    else startArgs.push(a);
  }
  return {startArgs,stateFile,dryRun};
}

function formalValidation(c) {
  const schema=validateConfig(c);
  const legacy=validate(c);
  return {
    schemaVersion:schema.schemaVersion,
    errors:[...new Set([...schema.errors,...legacy.errors])],
    warnings:[...new Set([...schema.warnings,...legacy.warnings])]
  };
}

try {
  if (command === 'help' || args.includes('--help') || args.includes('-h')) { usage(); process.exit(0); }
  if (command === 'version' || args.includes('--version') || args.includes('-v')) { console.log(VERSION); process.exit(0); }

  if (command === 'start' || command === 'check' || command === 'config') {
    const env = parseStartFlags(args);
    Object.assign(process.env, env);
    const c = loadConfig();
    if (command === 'config') {
      console.log(JSON.stringify(redactedConfig(c), null, 2));
      process.exit(0);
    }
    if (command === 'check') {
      const result = formalValidation(c);
      console.log(`AnchorWeight configuration check (schema v${result.schemaVersion})`);
      console.log(JSON.stringify(redactedConfig(c), null, 2));
      for (const w of result.warnings) console.log(`WARNING: ${w}`);
      for (const e of result.errors) console.error(`ERROR: ${e}`);
      process.exit(result.errors.length ? 1 : 0);
    }
    const result = formalValidation(c);
    for (const w of result.warnings) console.warn(`[AnchorWeight] WARNING: ${w}`);
    if (result.errors.length) throw new Error(result.errors.join(' '));
    await import('../app.js');
  } else if (command === 'status') {
    const { health, stats, url } = await fetchStats(args);
    console.log(`AnchorWeight ${health.version} @ ${url}`);
    console.log(`Mode: ${stats.mode} | Proxy: ${health.proxyEnabled ? 'on' : 'off'} | Active quarantines: ${stats.activeBlocks}`);
    console.log(`Profiles: ${stats.trackedProfiles} | Campaigns: ${stats.trackedCampaigns || 0} | Verified bots: ${stats.verifiedGoodBots} | Spoofed claims: ${stats.spoofedGoodBotClaims}`);
    console.log(`Lures: ${stats.lureVisits} | Valid traversals: ${stats.validTraversals} | Would-block: ${stats.wouldBlock} | Decoy responses: ${stats.quarantinedRequests}`);
  } else if (command === 'profiles') {
    const { stats } = await fetchStats(args);
    const rows = stats.topProfiles || [];
    if (!rows.length) console.log('No Bot DNA profiles recorded yet.');
    else console.table(rows.map(p => ({ ID: p.id, Score: p.score, Classification: p.classification, Requests: p.requestCount, Depth: p.maxDepth, Proofs: p.proofOfCrawl, GoodBot: p.goodBot?.verified ? p.goodBot.provider : '', Policy: p.manualPolicy || '' })));
  } else if (command === 'campaigns') {
    const { stats } = await fetchStats(args);
    const rows = stats.topCampaigns || [];
    if (!rows.length) console.log('No correlated bot campaigns recorded yet.');
    else console.table(rows.map(c => ({ Campaign:c.id, Confidence:`${c.confidence}%`, Classification:c.classification, Members:c.memberCount, Evidence:(c.evidence||[]).map(e=>e.reason).slice(-2).join(', ') })));
  } else if (command === 'events') {
    const {data}=await apiCall(args,a=>`/api/events?limit=${encodeURIComponent(a.limit)}&type=${encodeURIComponent(a.type)}&bot=${encodeURIComponent(a.bot)}&campaign=${encodeURIComponent(a.campaign)}&q=${encodeURIComponent(a.q)}`);
    const rows=data.events||[];
    if(!rows.length) console.log('No matching events.');
    else console.table(rows.map(e=>({Time:e.ts,Type:e.type,Bot:e.botId||e.botId||'',Path:e.path||'',Depth:e.depth??'',Reason:e.reason||'',Score:e.score??''})));
  } else if (command === 'investigate') {
    const {data,args:a}=await apiCall(args,a=>`/api/investigate?bot=${encodeURIComponent(a.bot)}&campaign=${encodeURIComponent(a.campaign)}`);
    if(!a.bot&&!a.campaign) throw new Error('investigate requires --bot AW-... or --campaign AWC-...');
    if(data.profile) console.log('Profile\n',JSON.stringify(data.profile,null,2));
    if(data.campaign) console.log('Campaign\n',JSON.stringify(data.campaign,null,2));
    console.log('\nTimeline');
    console.table((data.events||[]).map(e=>({Time:e.ts,Type:e.type,Bot:e.botId||'',Path:e.path||'',Depth:e.depth??'',Reason:e.reason||''})));
  } else if (command === 'policy') {
    const parsed=investigationArgs(args);
    if(!parsed.bot) throw new Error('policy requires --bot AW-XXXXXXXX');
    if(parsed.policy===undefined) throw new Error('policy requires one of --allow, --quarantine, or --clear');
    const session=await getCsrf(args);
    const {data}=await apiCall(args,a=>'/api/policy',{method:'POST',headers:{'X-AW-CSRF':session.csrfToken},body:JSON.stringify({botId:parsed.bot,policy:parsed.policy})});
    console.log(`Policy updated: ${data.profile.id} -> ${data.profile.manualPolicy||'automatic'}`);
  } else if (command === 'profile-list') {
    const fsmod=await import('node:fs'); const pathmod=await import('node:path');
    const dir=pathmod.resolve(process.cwd(),'config','profiles');
    const rows=[];
    try { for(const name of fsmod.readdirSync(dir).filter(x=>x.endsWith('.json')).sort()){const j=JSON.parse(fsmod.readFileSync(pathmod.join(dir,name),'utf8')); rows.push({Profile:name.replace(/\.json$/,''),Mode:(j.env||j).AW_SHADOW_MODE==='false'?'enforce':'shadow',Proxy:(j.env||j).AW_PROXY_ENABLED||'unset',ScoreEnforcement:(j.env||j).AW_SCORE_ENFORCEMENT_ENABLED||'unset'});}} catch {}
    console.table(rows);
  } else if (command === 'doctor') {
    process.exitCode = await doctor(args);
  } else if (command === 'backup') {
    const a=localOpsArgs(args); Object.assign(process.env,parseStartFlags(a.startArgs)); const c=loadConfig();
    const result=await backupFiles(c,a.dest||'./backups'); console.log(`Backup created: ${result.dir}`);
  } else if (command === 'restore') {
    const a=localOpsArgs(args); if(!a.source) throw new Error('restore requires --source <backup-directory>');
    Object.assign(process.env,parseStartFlags(a.startArgs)); const c=loadConfig();
    const manifest=restoreFiles(c,a.source); console.log(`Restored backup from ${a.source} (${manifest.createdAt||'unknown date'})`);
  } else if (command === 'report') {
    const a=localOpsArgs(args); Object.assign(process.env,parseStartFlags(a.startArgs)); const c=loadConfig();
    const result=await exportEvidence(c,a.out); console.log(`Evidence report: ${result.file}`); console.log(JSON.stringify(result.summary,null,2));
  } else if (command === 'prune') {
    const a=localOpsArgs(args); Object.assign(process.env,parseStartFlags(a.startArgs)); const c=loadConfig();
    const result=pruneEvents(c); console.log(`Event retention applied: ${result.before} -> ${result.after} (${result.removed||0} removed)`);
  } else if (command === 'state-check') {
    const a=stateCommandArgs(args); Object.assign(process.env,parseStartFlags(a.startArgs)); const c=loadConfig();
    const result=await inspectConfiguredState(c,a.stateFile);
    console.log(JSON.stringify(result,null,2));
  } else if (command === 'migrate') {
    const a=stateCommandArgs(args); Object.assign(process.env,parseStartFlags(a.startArgs)); const c=loadConfig();
    if(c.stateBackend==='sqlite' && !a.stateFile) throw new Error('SQLite imports legacy JSON automatically on first start; migrate only accepts JSON files (--state <path>)');
    const result=migrateStateFile(a.stateFile||c.stateFile,{dryRun:a.dryRun});
    console.log(JSON.stringify({file:result.file,dryRun:result.dryRun,fromVersion:result.fromVersion,toVersion:result.toVersion,migrations:result.applied,backup:result.backup||null},null,2));
  } else if (command === 'release-check') {
    const a=stateCommandArgs(args); Object.assign(process.env,parseStartFlags(a.startArgs)); const c=loadConfig();
    const cfg=formalValidation(c);
    console.log(`Config schema: v${cfg.schemaVersion}`);
    for(const w of cfg.warnings) console.log(`WARNING: ${w}`);
    for(const e of cfg.errors) console.error(`ERROR: ${e}`);
    let stateOk=true;
    try{
      const st=await inspectConfiguredState(c,a.stateFile);
      console.log(`State: v${st.fromVersion} -> v${st.toVersion}; profiles=${st.counts.profiles}; campaigns=${st.counts.campaigns}`);
      if(st.migrations.length) console.log(`Pending migrations: ${st.migrations.join(', ')}`);
    }catch(e){
      if(e?.code==='ENOENT') console.log('State: first run (no state file yet)');
      else { stateOk=false; console.error(`ERROR: State check failed: ${e.message}`); }
    }
    if(cfg.errors.length||!stateOk) process.exitCode=1;
    else console.log('Release check: PASS');
  } else if (command === 'trap-test') {
    await trapTest(args);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (err) {
  console.error(`AnchorWeight CLI: ${err.message}`);
  console.error('Run "anchorweight help" for usage.');
  process.exit(1);
}
