/**
 * Structured, bounded, permission-free security evidence.
 * Never put raw IP addresses, request headers, URLs containing signed tokens,
 * or AW_SECRET in persisted profile evidence.
 */
const MAX_PROFILE_EVIDENCE = 16;
const KINDS = new Set(['lure', 'traversal', 'invalid_traversal', 'proof_of_crawl', 'blackhole', 'repeat_offense']);

export function noteEvidence(store, key, details, now = Date.now()) {
  if (!KINDS.has(details?.kind)) throw new Error('unsupported evidence kind');
  const p = store.getProfile(key);
  p.evidence ||= [];
  const e = { at: now, kind: details.kind };
  if (typeof details.sid === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(details.sid)) e.sid = details.sid;
  if (typeof details.reason === 'string' && /^[a-z0-9_]{1,48}$/.test(details.reason)) e.reason = details.reason;
  for (const field of ['depth', 'branch', 'elapsedMs', 'offenseCount']) {
    if (Number.isSafeInteger(details[field]) && details[field] >= 0) e[field] = details[field];
  }
  p.evidence.push(e);
  if (p.evidence.length > MAX_PROFILE_EVIDENCE) p.evidence.splice(0, p.evidence.length - MAX_PROFILE_EVIDENCE);
  store.touchProfile?.(key);
  return e;
}
