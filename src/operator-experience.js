/**
 * AnchorWeight v2.6 local operator tools.
 *
 * These functions never accept network-supplied paths, change cPanel environment
 * variables, export secrets, or start the server. An import changes ONLY the
 * declarative gateway file while the operator has stopped the app. Restart is
 * required; this module intentionally does not claim to hot-apply CLI edits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateConfig } from './config-schema.js';
import { readDeclarative, parseDeclarative, configurationFile, serializeYaml } from './declarative-config.js';
import { readOperatorSettings } from './setup.js';
import { loadRoutes } from './routing.js';
import { readAuthPolicies } from './app-auth.js';
import { loadFallbacks } from './resilience.js';
import { loadAlertDocument } from './alerts.js';
import { inspectConfiguredState } from './ops.js';

export const MAX_IMPORT_BYTES = 32768;
const docFrom = settings => ({ version:1,
  proxy:{enabled:settings.proxyEnabled,defaultOrigin:settings.originUrl},
  routes:settings.routes.map(({path:routePath,origin})=>({path:routePath,origin}))
});

/** Resolve the settings that a new process would read, not stale dashboard data. */
export function effectiveGateway(config) {
  if(config.declarativeEnabled) return readDeclarative(config);
  const settings=readOperatorSettings(config);
  return {
    proxyEnabled:settings?.proxyEnabled ?? config.proxyEnabled,
    originUrl:settings?.originUrl ?? config.originUrl,
    routes:loadRoutes(config)
  };
}

/** Strict, bounded, safe-only gateway export; never includes credentials or evidence. */
export function exportGateway(config, format='json') {
  if(!['json','yaml'].includes(format))throw Error('unsupported_export_format');
  const gateway=effectiveGateway(config);
  const doc=docFrom(gateway);
  return format==='json'?JSON.stringify(doc,null,2)+'\n':serializeYaml(gateway);
}

/** Read the same inode we inspect, without following symbolic links on supported OSes. */
export function readSmallFile(file,limit=MAX_IMPORT_BYTES) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile() || stat.size<1 || stat.size>limit)throw Error('invalid_import_size_or_type');
    const buffer=Buffer.alloc(stat.size+1);
    const bytes=fs.readSync(fd,buffer,0,buffer.length,0);
    if(bytes!==stat.size)throw Error('import_changed_during_read');
    return buffer.subarray(0,bytes).toString('utf8');
  } finally {fs.closeSync(fd);}
}

/**
 * A validation-only import is the default. Applying an import requires two
 * explicit flags, refuses legacy route/config mode, and atomically replaces the
 * private declarative file. The immediately previous file is retained as .previous.
 */
export function importGateway(config, from, {apply=false,confirmStopped=false,rollback=false}={}) {
  if(!from && !rollback)throw Error('import_requires_source');
  if(apply && !confirmStopped)throw Error('stop_anchorweight_and_confirm_stopped');
  if(apply && !config.declarativeEnabled)throw Error('enable_declarative_mode_in_cpanel_first');
  if(apply && (config.routesEnabled || config.setupConfigEnabled))
    throw Error('disable_legacy_route_and_operator_modes_before_import');
  const target=configurationFile(config);
  const source=rollback?`${target}.previous`:path.resolve(from);
  // The existing parser decides JSON/YAML based on file extension; .previous
  // must retain the target's syntax. Never infer it from untrusted contents.
  const parsePath=rollback?target:source;
  const settings=parseDeclarative(config,readSmallFile(source),parsePath);
  const doc=docFrom(settings);
  const result={valid:true,applied:false,restartRequired:false,
    gateway:{proxyEnabled:settings.proxyEnabled,originUrl:settings.originUrl,
      routes:doc.routes},format:/\.json$/i.test(parsePath)?'json':'yaml'};
  if(!apply)return result;
  const dir=path.dirname(target);
  // Refuse missing/writable-by-others directories; do not fix deployment
  // permissions behind the operator's back or follow a swapped symlink.
  if(!fs.existsSync(dir))throw Error('private_data_directory_missing');
  const dirStat=fs.lstatSync(dir);
  if(!dirStat.isDirectory() || dirStat.isSymbolicLink())throw Error('unsafe_data_directory');
  if(process.platform!=='win32' && (dirStat.mode&0o022)!==0)throw Error('unsafe_data_directory_permissions');
  let current=null;
  try {current=readSmallFile(target);}catch(err){if(err.code!=='ENOENT')throw err;}
  const encoded=result.format==='json'?JSON.stringify(doc,null,2)+'\n':serializeYaml(settings);
  const next=`${target}.${process.pid}.${Date.now()}.tmp`;
  const previous=`${target}.previous`;
  const backup=`${previous}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(next,encoded,{flag:'wx',mode:0o600});
    if(current!==null) {
      fs.writeFileSync(backup,current,{flag:'wx',mode:0o600});
      fs.renameSync(backup,previous);
    }
    fs.renameSync(next,target);
  } catch(err) {
    for(const file of [next,backup])try{fs.unlinkSync(file);}catch{}
    throw err;
  }
  return {...result,applied:true,restartRequired:true,location:target,
    previousAvailable:current!==null};
}

/** Diagnostics are read-only: never mkdir, rotate evidence, or mutate a config. */
export async function diagnose(config,{env=process.env,probe=false,fetcher=fetch,platform=process.platform,nodeVersion=process.versions.node}={}) {
  const checks=[];
  const add=(name,status,detail,action='')=>checks.push({name,status,detail,action});
  const parts=nodeVersion.split('.').map(Number);
  add('Node.js',parts[0]>=20 && (config.stateBackend!=='sqlite' || parts[0]>22 || parts[0]===22&&parts[1]>=13)?'PASS':'FAIL',
    `Node ${nodeVersion}; SQLite needs Node 22.13+`, 'Select Node.js 22 in cPanel');
  const validation=validateConfig(config);
  add('Configuration schema',validation.valid?'PASS':'FAIL',validation.valid?'Valid':validation.errors.join('; '),
    'Review cPanel environment and enabled feature dependencies');
  add('Persistent secret',env.AW_SECRET?'PASS':'WARN',env.AW_SECRET?'Configured':'AW_SECRET not set; identity changes on restart',
    'Generate a persistent random secret in cPanel');
  add('Dashboard token',!config.dashboardEnabled||config.dashboardToken?'PASS':'WARN',
    config.dashboardEnabled&&!config.dashboardToken?'Dashboard is enabled but has no token':'Configured or disabled',
    'Set AW_DASHBOARD_TOKEN privately in cPanel');
  for(const [name,file] of [['State directory',config.stateBackend==='sqlite'?config.sqliteFile:config.stateFile],
    ['Event directory',config.logFile],['Audit directory',config.auditLogFile]]) {
    try {
      const parent=path.dirname(path.resolve(file));
      fs.accessSync(parent,fs.constants.W_OK);
      add(name,'PASS','Existing directory writable');
    } catch { add(name,'WARN','Missing or not writable; first start may create it',`Check parent directory for ${name}`); }
  }
  let gateway=null;
  try {
    gateway=effectiveGateway(config);
    add('Gateway configuration','PASS',config.declarativeEnabled?'Private declarative file valid':'Legacy/default configuration valid');
  } catch(err) {add('Gateway configuration','FAIL',err.message,'Check allowed origins, file permissions and configuration mode');}
  for(const [name,enabled,check] of [
    ['Application authentication',config.appAuthEnabled,()=>readAuthPolicies(config)],
    ['Webhook alerts',config.alertsEnabled,()=>loadAlertDocument(config)],
    ['Resilience',config.resilienceEnabled,()=>loadFallbacks(config,gateway?[gateway.originUrl,...gateway.routes.map(r=>r.origin)]:[config.originUrl])]
  ]) {
    if(!enabled){add(name,'SKIP','Disabled by operator');continue;}
    try {check();add(name,'PASS','Enabled policy readable and valid');}
    catch(err){add(name,'FAIL',err.message,'Review the private policy file and cPanel allowlist');}
  }
  try {
    const state=await inspectConfiguredState(config);
    add('Persisted state','PASS',`Schema ${state.toVersion}; ${state.counts.profiles} profiles`);
  } catch(err) {
    add('Persisted state',err?.code==='ENOENT'?'SKIP':'FAIL',
      err?.code==='ENOENT'?'First run: no state file yet':err.message,
      'Do not overwrite existing state; restore backup or inspect migration');
  }
  if(!config.proxyEnabled)add('Origin reachability','SKIP','Proxy disabled');
  else if(!probe)add('Origin reachability','SKIP','Use --probe to test approved origin');
  else if(!gateway)add('Origin reachability','SKIP','Gateway configuration invalid');
  else {
    try {
      // Probe only operator-configured origins. Never accept a URL from a request.
      const response=await fetcher(gateway.originUrl,{method:'HEAD',redirect:'manual',
        signal:AbortSignal.timeout(3000)});
      add('Origin reachability',response.status<500?'PASS':'WARN',`HEAD returned HTTP ${response.status}`);
    } catch(err){add('Origin reachability','WARN',err.name==='TimeoutError'?'Timed out':'Could not reach configured origin');}
  }
  const summary={pass:checks.filter(x=>x.status==='PASS').length,
    warn:checks.filter(x=>x.status==='WARN').length,
    fail:checks.filter(x=>x.status==='FAIL').length,
    skip:checks.filter(x=>x.status==='SKIP').length};
  return {version:'2.6.0',checks,summary,ok:summary.fail===0};
}
