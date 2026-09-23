// Browser-editable settings are intentionally limited to an allowlisted proxy origin and enable switch.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { validateConfig } from './config-schema.js';
export const OPERATOR_CONFIG_FILE = path.resolve(process.cwd(),'data','anchorweight-operator.json');

export function canonicalOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.trim() || value.trim() !== value) throw new Error('invalid_origin');
  let u;
  try { u = new URL(value); } catch { throw new Error('invalid_origin'); }
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.hash || u.search ||
      u.pathname !== '/' || !u.hostname || /[\r\n\t]/.test(value)) throw new Error('invalid_origin');
  return `${u.origin}/`;
}
export function allowedOrigins(config) {
  const entries=[config.setupBaselineOrigin,...(config.setupAllowedOrigins||[])];
  return [...new Set(entries.flatMap(v=>{try{return [canonicalOrigin(v)];}catch{return [];}}))];
}
export function validateOperatorSettings(config,input) {
  if (!input || typeof input!=='object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',')!=='originUrl,proxyEnabled' || typeof input.proxyEnabled!=='boolean') throw new Error('invalid_settings');
  const originUrl=canonicalOrigin(input.originUrl);
  if (!allowedOrigins(config).includes(originUrl)) throw new Error('origin_not_approved');
  if (config.setupPublicHost && new URL(originUrl).host.toLowerCase() === config.setupPublicHost.toLowerCase())
    throw new Error('self_proxy_origin');
  const validation=validateConfig({...config,originUrl,proxyEnabled:input.proxyEnabled});
  if (!validation.valid) throw new Error('invalid_config');
  return {proxyEnabled:input.proxyEnabled,originUrl};
}
export function readOperatorSettings(config,file=OPERATOR_CONFIG_FILE) {
  if (!config.setupConfigEnabled) return null;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('symlink_rejected');
    const doc=JSON.parse(fs.readFileSync(file,'utf8'));
    if (doc.version!==1) throw new Error('unsupported_version');
    return validateOperatorSettings(config,doc.settings);
  } catch(err) {
    if (err.code!=='ENOENT') console.warn('[AnchorWeight] Operator settings ignored:',err.message);
    return null; // Invalid local settings must not take down the dashboard.
  }
}
export function createSetupController(config,{file=OPERATOR_CONFIG_FILE,onActivate=()=>{}}={}) {
  function snapshot() {return {
    version:'1.9.0',configEnabled:!!config.setupConfigEnabled,
    writesEnabled:!!config.setupConfigEnabled&&!!config.setupWritesEnabled,
    settings:{proxyEnabled:config.proxyEnabled,originUrl:config.originUrl},
    allowedOrigins:allowedOrigins(config),shadowMode:config.shadowMode,
    source:config.setupSource||'environment',
    limitations:['Only cPanel-approved origins may be selected.','Crawler enforcement and secrets stay cPanel-controlled.']
  };}
  function validate(input) {
    const settings=validateOperatorSettings(config,input);
    return {ok:true,settings,change:settings.proxyEnabled!==config.proxyEnabled || canonicalOrigin(config.originUrl)!==settings.originUrl};
  }
  async function validateWithProbe(input) {
    const result=validate(input);
    const origin=new URL(result.settings.originUrl);
    const transport=origin.protocol==='https:'?https:http;
    result.originProbe=await new Promise(resolve=>{
      const req=transport.request(origin,{method:'HEAD',timeout:2000},res=>{
        res.resume();
        resolve({reachable:true,httpStatus:res.statusCode,healthy:(res.statusCode||500)<500});
      });
      req.once('timeout',()=>req.destroy(new Error('timeout')));
      req.once('error',err=>resolve({reachable:false,healthy:false,reason:err.message==='timeout'?'timeout':'connection_failed'}));
      req.end();
    });
    return result;
  }
  function apply(input) {
    if (!config.setupConfigEnabled || !config.setupWritesEnabled) throw new Error('setup_write_disabled');
    const {settings}=validate(input);
    const activate=onActivate(settings); // prepare next proxy before touching persisted/current state
    if (typeof activate!=='function') throw new Error('activation_not_prepared');
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const temp=`${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp,JSON.stringify({version:1,settings},null,2)+'\n',{flag:'wx',mode:0o600});
      fs.renameSync(temp,file);
    } catch(err) {try{fs.unlinkSync(temp);}catch{} throw err;}
    activate(); // prepared commit must not throw
    config.setupSource='operator-file';
    return snapshot();
  }
  return {snapshot,validate,validateWithProbe,apply};
}
