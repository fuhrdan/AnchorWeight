import fs from 'node:fs';
import path from 'node:path';

export function createLogger(file, options = {}) {
  const maxBytes = Math.max(1, Number(options.maxMb || 50)) * 1024 * 1024;
  const retentionDays = Math.max(1, Number(options.retentionDays || 30));
  function rotateIfNeeded() {
    try {
      const st = fs.statSync(file);
      if (st.size < maxBytes) return;
      const stamp = new Date().toISOString().replace(/[:.]/g,'-');
      fs.renameSync(file, `${file}.${stamp}`);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
  function pruneOld() {
    try {
      const dir = path.dirname(file), base = path.basename(file) + '.';
      const cutoff = Date.now() - retentionDays * 86400000;
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(base)) continue;
        const fp = path.join(dir,name);
        try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {}
      }
    } catch {}
  }
  return function log(event) {
    const record = { ts: new Date().toISOString(), ...event };
    try {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, { recursive: true });
      rotateIfNeeded();
      pruneOld();
      fs.appendFile(file, `${JSON.stringify(record)}\n`, () => {});
    } catch {
      // Logging must never break request handling.
    }
    console.log('[AnchorWeight]', JSON.stringify(record));
  };
}

export function readEvents(file, options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
  const type = String(options.type || '').trim();
  const botId = String(options.botId || '').trim().toUpperCase();
  const campaignId = String(options.campaignId || '').trim().toUpperCase();
  const search = String(options.search || '').trim().toLowerCase();
  const from = options.from ? Date.parse(options.from) : null;
  const to = options.to ? Date.parse(options.to) : null;
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const at = Date.parse(e.ts);
    if ((from !== null || to !== null) && (!Number.isFinite(at) || (from !== null && at < from) || (to !== null && at > to))) continue;
    const eventBotId = e.ipKey ? `AW-${String(e.ipKey).slice(0, 8).toUpperCase()}` : String(e.botId || '').toUpperCase();
    const text = JSON.stringify(e).toLowerCase();
    if (type && e.type !== type) continue;
    if (botId && eventBotId !== botId) continue;
    if (campaignId && String(e.campaignId || '').toUpperCase() !== campaignId && !text.includes(campaignId.toLowerCase())) continue;
    if (search && !text.includes(search)) continue;
    out.push(publicEvent(e));
  }
  return out;
}

function publicEvent(e) {
  const safe = {};
  const fields = ['ts','type','sid','campaignId','path','depth','branch','branchPath',
    'elapsedMs','reason','score','points','signal','offenses','minutes','until',
    'provider','policy','botId','members','confidence'];
  for (const field of fields) if (Object.hasOwn(e, field)) safe[field] = e[field];
  if (typeof safe.path === 'string') {
    // Keep the route category, not bearer-like signed canary path segments or queries.
    safe.path = safe.path.split('?')[0].replace(/\/t\/[^/]+(?:\/[^/]*)*/, '/t/[signed-path-redacted]');
    safe.path = safe.path.slice(0, 200);
  }
  if (e.ipKey) safe.botId = `AW-${String(e.ipKey).slice(0, 8).toUpperCase()}`;
  if (e.ownerKey) safe.ownerBotId = `AW-${String(e.ownerKey).slice(0, 8).toUpperCase()}`;
  if (e.otherKey) safe.otherBotId = `AW-${String(e.otherKey).slice(0, 8).toUpperCase()}`;
  return safe;
}
