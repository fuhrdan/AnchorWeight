import fs from 'node:fs';
import path from 'node:path';
import { migrateState, CURRENT_STATE_VERSION } from './migrations.js';

export function backupFiles(config, destination) {
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const dir = path.resolve(destination || './backups', `anchorweight-${stamp}`);
  fs.mkdirSync(dir, {recursive:true});
  const copied=[];
  for (const [label,file] of [['state',config.stateFile],['events',config.logFile]]) {
    try {
      const src=path.resolve(file), dest=path.join(dir,path.basename(file));
      fs.copyFileSync(src,dest); copied.push({label,file:dest});
    } catch (err) { if (err?.code!=='ENOENT') throw err; }
  }
  const manifest={version:'1.0.0',createdAt:new Date().toISOString(),profile:config.profileName||null,copied};
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
  return {dir,manifest};
}

export function restoreFiles(config, source) {
  const dir=path.resolve(source);
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  for (const item of manifest.copied||[]) {
    const src=path.join(dir,path.basename(item.file));
    const dest=item.label==='state'?path.resolve(config.stateFile):path.resolve(config.logFile);
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(src,dest);
  }
  return manifest;
}

export function exportEvidence(config, destination) {
  const state=readJson(config.stateFile,{});
  const events=readJsonLines(config.logFile);
  const report={
    version:'1.0.0',
    generatedAt:new Date().toISOString(),
    profile:config.profileName||null,
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
    meta:{...(migrated.state.meta||{}),appVersion:'1.0.0',migratedBy:'anchorweight migrate',writtenAt:new Date().toISOString()}
  }));
  fs.renameSync(temp,resolved);
  return {file:resolved,backup,dryRun:false,...migrated};
}
