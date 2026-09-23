/**
 * Opt-in sensor -> intelligence-hub transport. Not in the request path.
 * Evidence is projected through an allowlist; raw IPs, internal HMAC keys,
 * secrets, signed canary paths, cookies, sessions and headers never leave.
 */
import crypto from 'node:crypto';

export const FEDERATION_TYPES = new Set([
  'block', 'would_block', 'block_blackhole', 'would_block_blackhole',
  'campaign_correlation'
]);
const BOT_ID = /^AW-[A-Z0-9_-]{8}$/;
const CAMPAIGN_ID = /^AWC-[A-F0-9]{8}$/;
const SITE_ID = /^[a-z][a-z0-9_-]{2,31}$/;

export function siteIdValid(id) { return SITE_ID.test(id); }
export function projectFederatedEvent(event) {
  if (!event || !FEDERATION_TYPES.has(event.type)) return null;
  const out = { type: event.type };
  if (event.ipKey && /^[A-Za-z0-9_-]{8,}$/.test(event.ipKey)) {
    out.botId = `AW-${event.ipKey.slice(0, 8).toUpperCase()}`;
  } else if (BOT_ID.test(event.botId || '')) out.botId = event.botId;
  if (CAMPAIGN_ID.test(event.campaignId || '')) out.campaignId = event.campaignId;
  if (typeof event.reason === 'string' && /^[a-z_]{1,64}$/.test(event.reason)) out.reason = event.reason;
  if (Number.isSafeInteger(event.depth) && event.depth >= 0 && event.depth <= 8) out.depth = event.depth;
  if (Number.isSafeInteger(event.members) && event.members >= 2 && event.members <= 100000) out.members = event.members;
  if (Number.isSafeInteger(event.confidence) && event.confidence >= 0 && event.confidence <= 100) out.confidence = event.confidence;
  // The local instance verified the proof. Do not promote automation-score
  // events to verified proof; do not transmit token-bearing sids or paths.
  out.proof = ['block', 'would_block'].includes(event.type) ? 'local_signed_traversal' :
    ['block_blackhole', 'would_block_blackhole'].includes(event.type) ? 'local_robots_blackhole' :
    event.type === 'campaign_correlation' ? 'local_campaign_correlation' : 'behavioral_observation';
  if (!out.botId && !out.campaignId) return null;
  return out;
}
export function messageMac(secret, timestamp, nonce, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n${body}`).digest('hex');
}
export function validMac(a, b) {
  return typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) &&
    crypto.timingSafeEqual(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii'));
}

/** Bounded in-memory queue with retries; restart may lose untransmitted events. */
export function createEvidencePublisher(config, options = {}) {
  if (!config.intelligenceEnabled) return { publish: () => {}, stop: () => {}, status: () => ({enabled:false}) };
  const queue = [];
  const request = options.fetch || fetch;
  const delay = options.delay || ((cb, ms) => setTimeout(cb, ms).unref());
  let active = false, stopped = false, dropped = 0, sent = 0, failed = 0, retryMs = 1000;
  function pump() {
    if (active || stopped || !queue.length) return;
    active = true;
    const entry = queue[0];
    const payload = JSON.stringify({ schema:'anchorweight-evidence-v1', siteId:config.intelligenceSiteId,
      eventId:entry.id, observedAt:entry.observedAt, evidence:entry.evidence });
    const ts = String(Date.now()), nonce = crypto.randomBytes(16).toString('hex');
    Promise.resolve().then(() => request(config.intelligenceHubUrl, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json', 'X-AW-Site':config.intelligenceSiteId,
        'X-AW-Timestamp':ts, 'X-AW-Nonce':nonce,
        'X-AW-Signature':messageMac(config.intelligenceSiteSecret,ts,nonce,payload)}, body:payload
    })).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      queue.shift(); sent++; retryMs = 1000;
      active = false; pump();
    }).catch(() => {
      failed++; active = false;
      delay(pump, retryMs); retryMs = Math.min(60000,retryMs * 2);
    });
  }
  return {
    publish(event) {
      const evidence = projectFederatedEvent(event);
      if (!evidence || stopped) return;
      if (queue.length >= 256) { dropped++; return; }
      queue.push({id:crypto.randomUUID(),observedAt:new Date().toISOString(),evidence});
      pump();
    },
    stop() { stopped = true; },
    status() { return {enabled:true, queued:queue.length, dropped, sent, failed}; }
  };
}
