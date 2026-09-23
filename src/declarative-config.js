/**
 * v2.1 declarative gateway configuration.
 *
 * The file may describe only the proxy switch, approved default origin, and
 * approved path routes. Secrets, crawler policy and enforcement stay in cPanel.
 * YAML uses a deliberately documented, safe subset: mappings, lists of route
 * mappings, strings and booleans. No tags, references or arbitrary constructors.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { canonicalOrigin, allowedOrigins } from './setup.js';
import { validateRouteDocument } from './routing.js';
import { validateConfig } from './config-schema.js';

const MAX_BYTES = 32 * 1024;
const ROOT_KEYS = ['proxy', 'routes', 'version'];
const PROXY_KEYS = ['defaultOrigin', 'enabled'];

function keysAre(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.sort().join(',');
}
function plainObject() { return Object.create(null); }

/** Parse a conservative YAML subset, rejecting duplicate keys and special YAML features. */
export function parseSimpleYaml(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES) throw Error('config_too_large');
  const lines = [];
  for (const [index, raw] of source.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    if (/\t/.test(raw)) throw Error(`yaml_tabs_line_${index + 1}`);
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 || /[{}&*!|>]/.test(trimmed) || (/\[|\]/.test(trimmed) && !/^routes: \[\]$/.test(trimmed))) throw Error(`unsupported_yaml_line_${index + 1}`);
    lines.push({ indent, text: trimmed, line: index + 1 });
  }
  if (!lines.length || lines[0].indent !== 0) throw Error('invalid_yaml_root');
  let pos = 0;
  function scalar(raw, line) {
    const value = raw.trim();
    if (!value || value === 'null' || value === '~') throw Error(`invalid_yaml_value_${line}`);
    if (value === '[]') return [];
    if (/^[0-9]+$/.test(value)) return Number(value);
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value[0] === '"') {
      try { const s = JSON.parse(value); if (typeof s !== 'string') throw Error(); return s; }
      catch { throw Error(`invalid_yaml_string_${line}`); }
    }
    if (value[0] === "'") {
      if (!value.endsWith("'")) throw Error(`invalid_yaml_string_${line}`);
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (value.includes('#') || value.includes(': ') || /^[-?]/.test(value)) throw Error(`invalid_yaml_scalar_${line}`);
    return value;
  }
  function put(obj, entry, depth) {
    const match = /^([A-Za-z][A-Za-z0-9]*):(?:\s+(.*))?$/.exec(entry.text);
    if (!match) throw Error(`invalid_yaml_key_${entry.line}`);
    const [, key, inline] = match;
    if (Object.hasOwn(obj, key)) throw Error(`duplicate_yaml_key_${key}`);
    if (inline !== undefined) { obj[key] = scalar(inline, entry.line); return; }
    if (pos >= lines.length || lines[pos].indent !== depth + 2) throw Error(`invalid_yaml_indent_${entry.line}`);
    obj[key] = block(depth + 2);
  }
  function block(depth) {
    if (pos >= lines.length || lines[pos].indent !== depth) throw Error('invalid_yaml_indent');
    const array = lines[pos].text.startsWith('- ');
    const result = array ? [] : plainObject();
    while (pos < lines.length && lines[pos].indent === depth) {
      const item = lines[pos++];
      if (array) {
        if (!item.text.startsWith('- ')) throw Error(`mixed_yaml_types_${item.line}`);
        const obj = plainObject();
        put(obj, { ...item, text: item.text.slice(2) }, depth);
        while (pos < lines.length && lines[pos].indent === depth + 2) {
          put(obj, lines[pos++], depth);
        }
        result.push(obj);
      } else {
        if (item.text.startsWith('- ')) throw Error(`mixed_yaml_types_${item.line}`);
        put(result, item, depth);
      }
      if (pos < lines.length && lines[pos].indent > depth) throw Error(`unexpected_yaml_indent_${lines[pos].line}`);
    }
    return result;
  }
  const doc = block(0);
  if (pos !== lines.length || Array.isArray(doc)) throw Error('invalid_yaml_document');
  return doc;
}

export function serializeYaml(settings) {
  // JSON-quoted strings make generated YAML unambiguous and prevent injection.
  return `version: 1\nproxy:\n  enabled: ${settings.proxyEnabled}\n  defaultOrigin: ${JSON.stringify(settings.originUrl)}\nroutes:${settings.routes.length ? '\n' + settings.routes.map(r => `  - path: ${JSON.stringify(r.path)}\n    origin: ${JSON.stringify(r.origin)}`).join('\n') : ' []'}\n`;
}

/** File path is operator-controlled by env, never request-controlled. */
export function configurationFile(config) {
  const file = path.resolve(config.declarativeFile || './data/anchorweight-gateway.json');
  const data = path.resolve('./data');
  if (!file.startsWith(data + path.sep) || !/\.(?:json|ya?ml)$/i.test(file)) throw Error('invalid_declarative_path');
  return file;
}

export function validateDeclarative(config, doc) {
  if (!keysAre(doc, ROOT_KEYS) || doc.version !== 1 || !keysAre(doc.proxy, PROXY_KEYS) ||
      typeof doc.proxy.enabled !== 'boolean' || !Array.isArray(doc.routes)) throw Error('invalid_declarative_document');
  const originUrl = canonicalOrigin(doc.proxy.defaultOrigin);
  if (!allowedOrigins(config).includes(originUrl)) throw Error('origin_not_approved');
  const publicHost = String(config.setupPublicHost || '').toLowerCase();
  if (publicHost && (new URL(originUrl).host.toLowerCase() === publicHost || new URL(originUrl).hostname.toLowerCase() === publicHost)) throw Error('self_proxy_origin');
  const routes = doc.routes.length ? validateRouteDocument({ version:1, routes:doc.routes }, config) : Object.freeze([]);
  const proxyEnabled = doc.proxy.enabled;
  const validation = validateConfig({ ...config, originUrl, proxyEnabled });
  if (!validation.valid) throw Error('invalid_config');
  return Object.freeze({ proxyEnabled, originUrl, routes });
}

export function parseDeclarative(config, contents, file = configurationFile(config)) {
  if (Buffer.byteLength(contents) > MAX_BYTES) throw Error('config_too_large');
  let doc;
  try { doc = /\.json(?:\.previous)?$/i.test(file) ? JSON.parse(contents) : parseSimpleYaml(contents); }
  catch (err) { throw Error(`invalid_declarative_file:${err.message}`); }
  return validateDeclarative(config, doc);
}

export function readDeclarative(config, file = configurationFile(config)) {
  if (!config.declarativeEnabled) return null;
  // Do not follow a symlink or accept a non-file/oversized configuration.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('config_too_large_or_not_file');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const n = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (n > MAX_BYTES) throw Error('config_too_large');
    return parseDeclarative(config, buffer.subarray(0, n).toString('utf8'), file);
  } finally { fs.closeSync(fd); }
}

/** Browser editor: prepare first, back up previous file, then atomic replace and activate. */
export function createDeclarativeController(config, { file = configurationFile(config), onActivate = () => () => {} } = {}) {
  function snapshot() {
    return { version:'2.6.0', declarativeEnabled:true,
      configEnabled:true, writesEnabled:!!config.declarativeWritesEnabled,
      previousAvailable:fs.existsSync(`${file}.previous`),
      source:config.setupSource || 'declarative-file', shadowMode:config.shadowMode,
      settings:{ proxyEnabled:config.proxyEnabled, originUrl:config.originUrl,
        routes:(config.activeRoutes || []).map(r => ({ path:r.path, origin:r.origin })) },
      allowedOrigins:allowedOrigins(config),
      allowedRouteOrigins:config.routeAllowedOrigins || [],
      limitations:['Only preapproved origins may be selected.','Secrets and crawler enforcement stay in cPanel.'] };
  }
  function validate(input) {
    if (!keysAre(input, ['originUrl','proxyEnabled','routes'])) throw Error('invalid_settings');
    const settings=validateDeclarative(config,{ version:1,
      proxy:{ enabled:input.proxyEnabled, defaultOrigin:input.originUrl }, routes:input.routes });
    return {ok:true,settings:{...settings,routes:settings.routes.map(r=>({...r}))},
      change:JSON.stringify(settings)!==JSON.stringify({proxyEnabled:config.proxyEnabled,originUrl:config.originUrl,routes:config.activeRoutes||[]})};
  }
  async function validateWithProbe(input) {
    const result=validate(input);
    const targets=[result.settings.originUrl,...result.settings.routes.map(r=>r.origin)];
    result.originProbe=await Promise.all(targets.map(origin=>new Promise(resolve=>{
      const u=new URL(origin), transport=u.protocol==='https:'?https:http;
      const request=transport.request(u,{method:'HEAD',timeout:2000},res=>{
        res.resume();resolve({reachable:true,httpStatus:res.statusCode,healthy:(res.statusCode||500)<500});
      });
      request.once('timeout',()=>request.destroy(Error('timeout')));
      request.once('error',()=>resolve({reachable:false,healthy:false,reason:'connection_failed'}));
      request.end();
    })));
    return result;
  }
  function apply(input) {
    if (!config.declarativeEnabled || !config.declarativeWritesEnabled) throw Error('setup_write_disabled');
    const {settings}=validate(input);
    const activate=onActivate(settings); // Must prepare every proxy before any write or state mutation.
    if (typeof activate!=='function') throw Error('activation_not_prepared');
    const data=path.dirname(file);
    fs.mkdirSync(data,{recursive:true,mode:0o700});
    if (fs.lstatSync(data).isSymbolicLink()) throw Error('unsafe_data_directory');
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('unsafe_config_symlink');
    const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (current && current.length > MAX_BYTES) throw Error('config_too_large');
    const doc={version:1,proxy:{enabled:settings.proxyEnabled,defaultOrigin:settings.originUrl},routes:settings.routes};
    const encoded=/\.json$/i.test(file)?JSON.stringify(doc,null,2)+'\n':serializeYaml(settings);
    const temp=`${file}.${process.pid}.tmp`, previous=`${file}.previous`;
    try {
      fs.writeFileSync(temp,encoded,{flag:'wx',mode:0o600});
      if (current) {
        const backup=`${previous}.${process.pid}.tmp`;
        try {fs.writeFileSync(backup,current,{flag:'wx',mode:0o600});fs.renameSync(backup,previous);}
        catch(err){try{fs.unlinkSync(backup);}catch{}throw err;}
      }
      fs.renameSync(temp,file);
    } catch(err) {try{fs.unlinkSync(temp);}catch{} throw err;}
    activate(); // Prepared commit must not throw.
    config.setupSource='declarative-file';
    return snapshot();
  }
  /** Restore the immediately previous file after revalidating it against current allowlists. */
  function rollback() {
    if (!config.declarativeEnabled || !config.declarativeWritesEnabled) throw Error('setup_write_disabled');
    const previous=`${file}.previous`;
    let settings;
    try { settings=readDeclarative(config, previous); }
    catch(err) {if(err?.code==='ENOENT')throw Error('no_previous_configuration');throw err;}
    // The old destinations are revalidated against CURRENT allowlists before activation.
    const activate=onActivate(settings);
    if(typeof activate!=='function')throw Error('activation_not_prepared');
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('unsafe_config_symlink');
    const current=fs.readFileSync(file);
    if(current.length>MAX_BYTES)throw Error('config_too_large');
    const old=fs.readFileSync(previous);
    const temp=`${file}.${process.pid}.tmp`, backup=`${previous}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp,old,{flag:'wx',mode:0o600});
      fs.writeFileSync(backup,current,{flag:'wx',mode:0o600});
      fs.renameSync(backup,previous);
      fs.renameSync(temp,file);
    } catch(err) { for(const f of [temp,backup])try{fs.unlinkSync(f);}catch{}throw err; }
    activate();
    config.setupSource='declarative-file';
    return snapshot();
  }
  return { snapshot, validate, validateWithProbe, apply, rollback };
}
