import fs from 'node:fs';
import path from 'node:path';
import { migrateState, CURRENT_STATE_VERSION } from './migrations.js';

/** Return a stable SQLite snapshot. Never copy a live WAL-mode database file. */
async function backupSqlite(source, destination) {
  const { DatabaseSync, backup } = await import('node:sqlite');
  const db = new DatabaseSync(path.resolve(source), { readOnly: true });
  try { await backup(db, destination); } finally { db.close(); }
}

/** Reconstruct state for reports and inspections without changing the database. */
async function readSqliteState(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.resolve(file), { readOnly: true });
  try {
    const version = db.prepare("SELECT value FROM metadata WHERE key='state_version'").get();
    if (!version) throw new Error('Missing SQLite state version');
    if (Number(version.value) !== CURRENT_STATE_VERSION) throw new Error('Unsupported SQLite state version');
    const result = { version: CURRENT_STATE_VERSION, blocks:[], offenses:[], profiles:[], campaigns:[] };
    for (const r of db.prepare('SELECT kind,key,value FROM entries').all()) {
      if (!Array.isArray(result[r.kind])) throw new Error(`Unexpected SQLite state kind ${r.kind}`);
      result[r.kind].push([r.key, JSON.parse(r.value)]);
    }
    return result;
  } finally { db.close(); }
}


export async function backupFiles(config, destination) {
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const dir = path.resolve(destination || './backups', `anchorweight-${stamp}`);
  fs.mkdirSync(dir, {recursive:true});
  const copied=[];
  const backend=config.stateBackend || 'json';
  if (backend==='sqlite' && fs.existsSync(config.sqliteFile)) {
    const dest=path.join(dir,path.basename(config.sqliteFile));
    await backupSqlite(config.sqliteFile,dest);
    copied.push({label:'sqlite-state',file:dest});
  } else if (backend==='json' && fs.existsSync(config.stateFile)) {
    const dest=path.join(dir,path.basename(config.stateFile));
    fs.copyFileSync(config.stateFile,dest);copied.push({label:'state',file:dest});
  }
  if (backend==='sqlite' && fs.existsSync(config.stateFile)) {
    const dest=path.join(dir,path.basename(config.stateFile));
    fs.copyFileSync(config.stateFile,dest);copied.push({label:'legacy-json',file:dest});
  }
  for(const [label,file] of [['events',config.logFile],['audit',config.auditLogFile]]) {
    if (!file || !fs.existsSync(file)) continue;
    const dest=path.join(dir,path.basename(file));
    fs.copyFileSync(file,dest);copied.push({label,file:dest});
  }
  const manifest={version:'2.6.0',stateBackend:backend,createdAt:new Date().toISOString(),profile:config.profileName||null,copied};
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
  return {dir,manifest};
}

export function restoreFiles(config, source) {
  const dir=path.resolve(source);
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  const backend=config.stateBackend || 'json';
  if ((manifest.stateBackend || 'json') !== backend) throw new Error('Backup backend does not match AW_STATE_BACKEND; restore using the original backend');
  // Restore only while AnchorWeight is stopped. SQLite WAL files must not be replayed over the snapshot.
  for (const item of manifest.copied||[]) {
    const src=path.join(dir,path.basename(item.file));
    const dest=item.label==='sqlite-state'?path.resolve(config.sqliteFile)
      : item.label==='state'||item.label==='legacy-json'?path.resolve(config.stateFile)
      : item.label==='audit'?path.resolve(config.auditLogFile):path.resolve(config.logFile);
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    if (item.label==='sqlite-state') {
      // Checkpointed backup is self-contained: remove obsolete sidecars while service is stopped.
      for (const sidecar of [`${dest}-wal`,`${dest}-shm`]) fs.rmSync(sidecar,{force:true});
    }
    fs.copyFileSync(src,dest);
  }
  return manifest;
}

export async function exportEvidence(config, destination) {
  const state=(config.stateBackend==='sqlite' && fs.existsSync(config.sqliteFile))
    ? await readSqliteState(config.sqliteFile) : config.stateBackend==='sqlite' ? {} : readJson(config.stateFile,{});
  const events=readJsonLines(config.logFile);
  const report={
    version:'2.6.0',
    generatedAt:new Date().toISOString(),
    profile:config.profileName||null,
    stateBackend:config.stateBackend||'json',
    summary:{
      events:events.length,
      blocks:(state.blocks||[]).length,
      profiles:(state.profiles||[]).length,
      campaigns:(state.campaigns||[]).length
    },
    recentEvents:events.slice(-250).reverse()
  };
  const out=path.resolve(destination||`./reports/anchorweight-evidence-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2));
  return {file:out,summary:report.summary};
}

export function pruneEvents(config) {
  const file=path.resolve(config.logFile);
  let lines=[];
  try { lines=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean); } catch(err){ if(err?.code==='ENOENT') return {before:0,after:0}; throw err; }
  const cutoff=Date.now()-config.eventRetentionDays*86400000;
  const kept=lines.filter(line=>{try{return Date.parse(JSON.parse(line).ts)>=cutoff}catch{return false}});
  fs.writeFileSync(file,kept.length?kept.join('\n')+'\n':'');
  return {before:lines.length,after:kept.length,removed:lines.length-kept.length};
}

function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}}
function readJsonLines(file){try{return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean)}catch{return []}}


export async function inspectConfiguredState(config, override) {
  if (override || config.stateBackend!=='sqlite') return inspectState(override||config.stateFile);
  const state=await readSqliteState(config.sqliteFile);
  return { file:path.resolve(config.sqliteFile),backend:'sqlite',fromVersion:state.version,toVersion:state.version,migrations:[],
    counts:{blocks:state.blocks.length,offenses:state.offenses.length,profiles:state.profiles.length,campaigns:state.campaigns.length} };
}

export function inspectState(file) {
  const resolved=path.resolve(file);
  const raw=JSON.parse(fs.readFileSync(resolved,'utf8'));
  const migrated=migrateState(raw);
  return {
    file:resolved,
    fromVersion:migrated.fromVersion,
    toVersion:migrated.toVersion,
    migrations:migrated.applied,
    counts:{
      blocks:(migrated.state.blocks||[]).length,
      offenses:(migrated.state.offenses||[]).length,
      profiles:(migrated.state.profiles||[]).length,
      campaigns:(migrated.state.campaigns||[]).length
    }
  };
}

export function migrateStateFile(file, options={}) {
  const resolved=path.resolve(file);
  const raw=JSON.parse(fs.readFileSync(resolved,'utf8'));
  const migrated=migrateState(raw);
  if (options.dryRun) return {file:resolved,dryRun:true,...migrated};
  if (!migrated.applied.length && raw.version===CURRENT_STATE_VERSION) return {file:resolved,dryRun:false,...migrated};
  const backup=`${resolved}.pre-v1-${Date.now()}.bak`;
  fs.copyFileSync(resolved,backup);
  const temp=`${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temp,JSON.stringify({
    ...migrated.state,
    meta:{...(migrated.state.meta||{}),appVersion:'2.6.0',migratedBy:'anchorweight migrate',writtenAt:new Date().toISOString()}
  }));
  fs.renameSync(temp,resolved);
  return {file:resolved,backup,dryRun:false,...migrated};
}
