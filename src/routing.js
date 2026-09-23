// v1.9 optional, file-backed multi-origin routing. No requests or secrets in route metadata.
// Route definitions are loaded at startup, not from HTTP request data or forwarded headers.
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES=32768;
const MAX_ROUTES=16;

export function normalizeRouteOrigin(value){
  if(typeof value!=='string'||value.trim()!==value||value.length>2048||!value)throw Error('invalid_route_origin');
  let u;
  try{u=new URL(value);}catch{throw Error('invalid_route_origin');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||u.search||u.pathname!=='/'||
      /[\x00-\x20\x7f]/.test(value))throw Error('invalid_route_origin');
  return `${u.origin}/`;
}

export function normalizeRoutePath(value){
  if(typeof value!=='string'||value.length>128||value==='/'||!/^\/[A-Za-z0-9/_-]+$/.test(value)||
      value.endsWith('/')||value.includes('//')||value.split('/').includes('..')||value.split('/').includes('.'))
    throw Error('invalid_route_path');
  return value;
}
function matches(prefix,pathname){return pathname===prefix||pathname.startsWith(`${prefix}/`);}
function reservedPath(prefix,basePath){
  const protectedPaths=['/live','/health','/ready','/dashboard.html','/setup.html',basePath];
  return protectedPaths.some(p=>matches(prefix,p)||matches(p,prefix));
}
export function validateRouteDocument(doc,config){
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||Object.keys(doc).sort().join(',')!=='routes,version'||
      doc.version!==1||!Array.isArray(doc.routes)||doc.routes.length<1||doc.routes.length>MAX_ROUTES)
    throw Error('invalid_route_document');
  const allow=new Set((config.routeAllowedOrigins||[]).map(normalizeRouteOrigin));
  const seen=new Set();
  const publicHost=String(config.setupPublicHost||'').toLowerCase();
  if(!publicHost)throw Error('route_public_host_required');
  const routes=doc.routes.map(route=>{
    if(!route||typeof route!=='object'||Array.isArray(route)||Object.keys(route).sort().join(',')!=='origin,path')
      throw Error('invalid_route_entry');
    const path=normalizeRoutePath(route.path);
    if(seen.has(path))throw Error('duplicate_route_path');
    if(reservedPath(path,config.basePath||'/anchor'))throw Error('reserved_route_path');
    const origin=normalizeRouteOrigin(route.origin);
    const u=new URL(origin);
    if(u.hostname.toLowerCase()===publicHost||u.host.toLowerCase()===publicHost)throw Error('self_proxy_route');
    if(!allow.has(origin))throw Error('route_origin_not_approved');
    seen.add(path);
    return Object.freeze({path,origin});
  });
  return Object.freeze(routes.sort((a,b)=>b.path.length-a.path.length||a.path.localeCompare(b.path)));
}
export function loadRoutes(config){
  if(!config.routesEnabled)return Object.freeze([]);
  const file=path.resolve(config.routesFile||'./data/anchorweight-routes.json');
  // O_NOFOLLOW (where supported) also prevents a symlink swapped after lstat.
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('route_file_invalid_size_or_type');
    const buf=Buffer.alloc(stat.size+1);
    const read=fs.readSync(fd,buf,0,buf.length,0);
    if(read>MAX_BYTES)throw Error('route_file_too_large');
    return validateRouteDocument(JSON.parse(buf.subarray(0,read).toString('utf8')),config);
  }finally{fs.closeSync(fd);}
}
export function routeForPath(routes,pathname){
  for(const route of routes)if(matches(route.path,pathname))return route;
  return null;
}
export function unsafeRoutePath(pathname){
  // Refuse ambiguous URL spellings instead of letting routing and the upstream normalize differently.
  return pathname.startsWith('//')||pathname.includes('\\')||/%(?:2f|5c|2e)/i.test(pathname);
}
export function routeSummary(routes,enabled){return {enabled:!!enabled,count:routes.length,
  routes:routes.map(({path})=>({path})),defaultRoute:'AW_ORIGIN_URL',selection:'longest_segment_prefix',
  scope:'local_process',configuration:'restart_required'};}
