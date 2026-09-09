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
    const eventBotId = e.ipKey ? `AW-${String(e.ipKey).slice(0, 8).toUpperCase()}` : '';
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
  const safe = { ...e };
  if (safe.ipKey) {
    safe.botId = `AW-${String(safe.ipKey).slice(0, 8).toUpperCase()}`;
    delete safe.ipKey;
  }
  if (safe.ownerKey) {
    safe.ownerBotId = `AW-${String(safe.ownerKey).slice(0, 8).toUpperCase()}`;
    delete safe.ownerKey;
  }
  if (safe.otherKey) {
    safe.otherBotId = `AW-${String(safe.otherKey).slice(0, 8).toUpperCase()}`;
    delete safe.otherKey;
  }
  return safe;
}
