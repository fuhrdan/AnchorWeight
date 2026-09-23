/**
 * Standalone optional intelligence hub. Single-process append-only JSONL pilot,
 * no network-wide enforcement; site IDs scope local profile IDs. Configure an
 * authenticated reverse proxy/TLS before exposing the hub to the internet.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { messageMac, validMac, siteIdValid, projectFederatedEvent } from './distributed.js';

const MAX_BODY = 4096;
const MAX_EVENTS = 2000;
const MAX_SKEW = 5 * 60 * 1000;

export function createIntelligenceHub({sites, file, adminToken, now = () => Date.now()} = {}) {
  if (!sites || typeof sites !== 'object' || !Object.keys(sites).length ||
    Object.entries(sites).some(([id,secret]) => !siteIdValid(id) || typeof secret !== 'string' || secret.length < 32)) {
    throw new Error('Each hub site must have a valid ID and an independent secret of >=32 characters');
  }
  if (typeof adminToken !== 'string' || adminToken.length < 32) throw new Error('A separate hub admin token of >=32 characters is required');
  if (!file) throw new Error('Hub evidence file is required');
  const seenNonces = new Map();
  const seenIds = new Set();
  let events = [];
  try {
    const lines = fs.readFileSync(file,'utf8').split('\n').filter(Boolean);
    for (const line of lines.slice(-MAX_EVENTS)) {
      try {
        const e = JSON.parse(line);
        if (!siteIdValid(e.siteId) || typeof e.eventId !== 'string') continue;
        events.push(e); seenIds.add(`${e.siteId}:${e.eventId}`);
      } catch { /* skip incomplete final lines */ }
    }
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  function persist(event) {
    fs.mkdirSync(path.dirname(file), {recursive:true,mode:0o700});
    fs.appendFileSync(file,JSON.stringify(event)+'\n',{mode:0o600});
    events.push(event); seenIds.add(`${event.siteId}:${event.eventId}`);
    if (events.length > MAX_EVENTS) {
      events = events.slice(-MAX_EVENTS);
      seenIds.clear();
      for (const e of events) seenIds.add(`${e.siteId}:${e.eventId}`);
      // Bounded on disk too; avoid accumulating unbounded evidence.
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, events.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
      fs.renameSync(tmp,file);
    }
  }
  function response(res,status,obj) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(obj));
  }
  function authenticate(req) {
    const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '')?.[1];
    return token && crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(token).digest()),
      Buffer.from(crypto.createHash('sha256').update(adminToken).digest()));
  }
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (pathname === '/live' && req.method === 'GET') return response(res,200,{ok:true,service:'AnchorWeight Intelligence Hub',version:'1.6.0'});
    if (pathname === '/v1/events' && req.method === 'GET') {
      if (!authenticate(req)) return response(res,401,{error:'unauthorized'});
      const limit = Math.min(100,Math.max(1,Number(new URL(req.url,'http://localhost').searchParams.get('limit')) || 50));
      return response(res,200,{version:'1.6.0',siteCount:new Set(events.map(e=>e.siteId)).size,
        total:events.length,events:events.slice(-limit).reverse(),limitations:[
          'Bot IDs are site-scoped; a matching ID from different sites is not an identity correlation.',
          'A site attests to local evidence; the hub does not independently verify signed canary paths.',
          'No automatic cross-site quarantine or common-operator attribution.'
        ]});
    }
    if (pathname !== '/v1/evidence' || req.method !== 'POST') return response(res,404,{error:'not_found'});
    const site = req.headers['x-aw-site'];
    const ts = req.headers['x-aw-timestamp'];
    const nonce = req.headers['x-aw-nonce'];
    const mac = req.headers['x-aw-signature'];
    if (typeof site !== 'string' || !Object.hasOwn(sites,site) || typeof ts !== 'string' || !/^\d{13}$/.test(ts) ||
      Math.abs(now()-Number(ts)) > MAX_SKEW || typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce)) {
      return response(res,401,{error:'invalid_authentication'});
    }
    const replayKey = `${site}:${nonce}`;
    for (const [k,time] of seenNonces) if (time < now()-MAX_SKEW) seenNonces.delete(k);
    if (seenNonces.has(replayKey)) return response(res,409,{error:'replay'});
    if (seenNonces.size >= 8192) return response(res,429,{error:'hub_busy'});
    let size=0, chunks=[], done=false;
    req.on('data',chunk=>{
      size+=chunk.length;
      if (size>MAX_BODY) {done=true;chunks=[];response(res,413,{error:'too_large'});req.destroy();}
      else if (!done) chunks.push(chunk);
    });
    req.on('end',()=>{
      if (done) return;
      const body=Buffer.concat(chunks).toString('utf8');
      if (!validMac(mac,messageMac(sites[site],ts,nonce,body))) return response(res,401,{error:'invalid_signature'});
      seenNonces.set(replayKey,now());
      let data;
      try { data=JSON.parse(body); } catch {return response(res,400,{error:'invalid_json'});}
      if (data.schema !== 'anchorweight-evidence-v1' || data.siteId !== site ||
          typeof data.eventId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.eventId) ||
          typeof data.observedAt !== 'string' || !Number.isFinite(Date.parse(data.observedAt)) ||
          Math.abs(now()-Date.parse(data.observedAt))>86400000 ||
          !data.evidence || typeof data.evidence !== 'object' || Array.isArray(data.evidence) ||
          JSON.stringify(projectFederatedEvent(data.evidence)) !== JSON.stringify(data.evidence)) {
        return response(res,400,{error:'invalid_evidence'});
      }
      if (seenIds.has(`${site}:${data.eventId}`)) return response(res,200,{ok:true,duplicate:true});
      try { persist({siteId:site,eventId:data.eventId,observedAt:data.observedAt,receivedAt:new Date(now()).toISOString(),
        evidence:data.evidence}); }
      catch { return response(res,503,{error:'storage_unavailable'}); }
      return response(res,202,{ok:true});
    });
    req.on('error',()=>{if (!res.writableEnded) response(res,400,{error:'read_failed'});});
  });
  return {server,getEvents:()=>[...events]};
}
