/**
 * v2.3 per-origin circuit breaker and bounded health probes.
 *
 * Security boundary: origin choices come ONLY from startup-validated configuration.
 * A client may choose a URL path, but can never supply an upstream host.
 *
 * An open circuit may send a NEW bodyless GET/HEAD to an approved fallback.
 * No already-started request is retried, even if its transport fails. Unsafe
 * methods are never sent to a fallback and receive a 503 when the primary opens.
 * All state is process-local, bounded, advisory, and resets on restart.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { canonicalOrigin } from './setup.js';

const MAX_FILE_BYTES = 16384;
const MAX_FALLBACKS = 16;

function safeRead(file) {
  // The configuration file must be inside private data/, not a client-supplied path.
  const resolved = path.resolve(file);
  const data = path.resolve('./data');
  if (!resolved.startsWith(data + path.sep) || !resolved.endsWith('.json'))
    throw Error('resilience_file_must_be_json_in_data');
  const fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw Error('invalid_resilience_file');
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      throw Error('resilience_file_permissions_require_0600');
    const bytes = Buffer.alloc(stat.size + 1);
    const n = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (n !== stat.size || n > MAX_FILE_BYTES) throw Error('invalid_resilience_file');
    return JSON.parse(bytes.subarray(0, n).toString('utf8'));
  } finally { fs.closeSync(fd); }
}

/** Return a Map of canonical primary -> canonical approved fallback. */
export function validateFallbacks(doc, config, primaryOrigins) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) ||
      Object.keys(doc).sort().join(',') !== 'fallbacks,version' || doc.version !== 1 ||
      !Array.isArray(doc.fallbacks) || doc.fallbacks.length > MAX_FALLBACKS)
    throw Error('invalid_resilience_document');
  const primary = new Set(primaryOrigins.map(canonicalOrigin));
  const allow = new Set((config.resilienceAllowedOrigins || []).map(canonicalOrigin));
  const mapping = new Map();
  for (const entry of doc.fallbacks) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'fallback,origin') throw Error('invalid_fallback_entry');
    const origin = canonicalOrigin(entry.origin);
    const fallback = canonicalOrigin(entry.fallback);
    if (!primary.has(origin)) throw Error('unknown_primary_origin');
    if (!allow.has(fallback)) throw Error('fallback_not_approved');
    if (origin === fallback || primary.has(fallback)) throw Error('fallback_must_be_distinct_from_primaries');
    if (mapping.has(origin)) throw Error('duplicate_primary_origin');
    const publicHost = String(config.setupPublicHost || '').toLowerCase();
    if (publicHost && [new URL(fallback).host, new URL(fallback).hostname]
      .some(host => host.toLowerCase() === publicHost)) throw Error('self_proxy_fallback');
    mapping.set(origin, fallback);
  }
  return mapping;
}

export function loadFallbacks(config, primaryOrigins) {
  if (!config.resilienceEnabled || !config.resilienceFallbackFile) return new Map();
  return validateFallbacks(safeRead(config.resilienceFallbackFile), config, primaryOrigins);
}

const initialState = () => ({ state:'closed', failures:0, openedAt:null, halfOpenBusy:false,
  lastStatus:null, lastCheckedAt:null, latencyMs:null, successes:0, rejected:0 });

/** The transport is injectable so unit tests never need external network access. */
export function createResilience(config, {
  fallbacks = new Map(), now = () => Date.now(),
  requestHttp = http.request, requestHttps = https.request, onTransition = () => {}
} = {}) {
  const enabled = !!config.resilienceEnabled;
  const states = new Map();
  let timer = null, stopped = false, inFlight = false;
  const counters = { fallbackSelections:0, unavailable:0, probeFailures:0 };
  const known = () => new Set([...((config.activeRoutes || []).map(r => canonicalOrigin(r.origin))),
    canonicalOrigin(config.originUrl), ...fallbacks.values()]);
  function sync() {
    const origins = known();
    for (const origin of origins) if (!states.has(origin)) states.set(origin, initialState());
    for (const origin of states.keys()) if (!origins.has(origin)) states.delete(origin);
  }
  function stateFor(origin) {
    sync();
    const key = canonicalOrigin(origin);
    if (!states.has(key)) throw Error('unregistered_origin');
    return states.get(key);
  }
  function success(origin, status, checked = false, latencyMs = null) {
    if (!enabled) return;
    const s = stateFor(origin);
    const wasUnavailable = s.state === 'open' || s.state === 'half_open';
    s.failures = 0;
    s.state = 'closed';
    s.halfOpenBusy = false;
    s.openedAt = null;
    s.lastStatus = status;
    if (checked) { s.lastCheckedAt = new Date(now()).toISOString(); s.latencyMs = latencyMs; }
    s.successes++;
    if (wasUnavailable) { try { onTransition({kind:'circuit_recovered',origin:canonicalOrigin(origin)}); } catch {} }
  }
  function failure(origin, status = null, checked = false, latencyMs = null) {
    if (!enabled) return;
    const s = stateFor(origin);
    s.failures++;
    s.halfOpenBusy = false;
    s.lastStatus = status;
    if (checked) { s.lastCheckedAt = new Date(now()).toISOString(); s.latencyMs = latencyMs; counters.probeFailures++; }
    if (s.failures >= config.resilienceFailureThreshold) {
      const newlyOpen = s.state !== 'open';
      s.state = 'open';
      s.openedAt = now();
      if (newlyOpen) { try { onTransition({kind:'circuit_open',origin:canonicalOrigin(origin)}); } catch {} }
    }
  }
  function response(origin, status) {
    if (!enabled) return;
    if (status >= 500) failure(origin, status);
    else success(origin, status);
  }
  function safeMethod(req) {
    return ['GET', 'HEAD'].includes(req.method) &&
      !req.headers['content-length'] && !req.headers['transfer-encoding'];
  }
  /** Return one approved target or null. Null signals a 503 without forwarding. */
  function choose(origin, req) {
    if (!enabled) return new URL(origin).href; // Preserve legacy non-root URLs when feature is off.
    const primary = canonicalOrigin(origin);
    const s = stateFor(primary);
    if (s.state === 'closed') return primary;
    if (s.state === 'open' && now() - s.openedAt >= config.resilienceCooldownMs) {
      s.state = 'half_open';
      s.halfOpenBusy = false;
    }
    if (s.state === 'half_open' && !s.halfOpenBusy && safeMethod(req)) {
      s.halfOpenBusy = true;
      return primary; // Only one fresh read-only request tests the recovering origin.
    }
    const fallback = fallbacks.get(primary);
    if (fallback && safeMethod(req) && stateFor(fallback).state === 'closed') {
      counters.fallbackSelections++;
      return fallback;
    }
    s.rejected++;
    counters.unavailable++;
    return null;
  }
  async function probe(origin) {
    const started = now();
    const transport = new URL(origin).protocol === 'https:' ? requestHttps : requestHttp;
    const result = await new Promise(resolve => {
      let settled = false;
      const done = value => { if (!settled) { settled = true; resolve(value); } };
      let request;
      try {
        request = transport(origin, { method:'HEAD', timeout:config.resilienceHealthTimeoutMs }, res => {
          res.resume();
          done({ status:res.statusCode || 502 });
        });
        request.once('timeout', () => request.destroy(Error('timeout')));
        request.once('error', () => done({ status:null }));
        request.end();
      } catch { done({ status:null }); }
    });
    if (stopped) return;
    const elapsed = Math.max(0, now() - started);
    if (result.status !== null && result.status < 500) success(origin, result.status, true, elapsed);
    else failure(origin, result.status, true, elapsed);
  }
  async function probeAll() {
    if (!enabled || !config.resilienceHealthEnabled || !config.proxyEnabled || stopped || inFlight) return;
    inFlight = true;
    try {
      sync();
      // Two concurrent probes maximum: bounded on small shared-hosting accounts.
      const items = [...states.keys()];
      for (let index = 0; index < items.length; index += 2)
        await Promise.all(items.slice(index, index + 2).map(probe));
    } finally { inFlight = false; }
  }
  function start() {
    if (!enabled || !config.resilienceHealthEnabled || timer) return;
    stopped = false;
    timer = setInterval(() => probeAll().catch(err =>
      console.warn('[AnchorWeight] resilience health probe:', err.message)), config.resilienceHealthIntervalMs);
    timer.unref?.();
    probeAll().catch(err => console.warn('[AnchorWeight] resilience health probe:', err.message));
  }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  function snapshot() {
    if (!enabled) return { enabled:false, healthEnabled:false, fallbackCount:0, origins:[], ...counters };
    sync();
    const labels = new Map([[canonicalOrigin(config.originUrl), '/ (default)'],
      ...(config.activeRoutes || []).map(r => [canonicalOrigin(r.origin), r.path])]);
    return {
      enabled:true, healthEnabled:!!config.resilienceHealthEnabled,
      fallbackCount:fallbacks.size, ...counters, scope:'in_memory_per_process',
      origins:[...states].map(([origin, s]) => ({
        path:labels.get(origin) || '(fallback)', state:s.state, failures:s.failures,
        lastStatus:s.lastStatus, lastCheckedAt:s.lastCheckedAt,
        latencyMs:s.latencyMs, hasFallback:fallbacks.has(origin)
      }))
    };
  }
  return { choose, response, failure, success, probeAll, start, stop, snapshot };
}
