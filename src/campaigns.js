import crypto from 'node:crypto';

function campaignId(secret, a, b) {
  const pair = [a,b].sort().join(':');
  return `AWC-${crypto.createHmac('sha256', secret).update(`campaign:${pair}`).digest('hex').slice(0,8).toUpperCase()}`;
}

export class CampaignEngine {
  constructor(config, store, log = () => {}, now = () => Date.now()) {
    this.config = config; this.store = store; this.log = log; this.now = now;
  }
  correlate(a, b, reason, detail = {}) {
    if (!a || !b || a === b) return null;
    let existing = this.store.findCampaignByMember?.(a) || this.store.findCampaignByMember?.(b);
    const id = existing?.id || campaignId(this.config.secret, a, b);
    const c = this.store.getCampaign(id);
    const duplicate = c.evidence.some(e => e.reason === reason && detail.sid && e.sid === detail.sid &&
      [a, b].every(key => c.members.includes(key)));
    if (duplicate) return c;
    for (const k of [a,b]) if (!c.members.includes(k)) c.members.push(k);
    c.firstSeen ||= this.now(); c.lastSeen = this.now();
    c.evidence.push({ at: this.now(), reason, ...detail });
    if (c.evidence.length > 32) c.evidence.shift();
    c.confidence = Math.min(100, c.confidence + (reason === 'shared_signed_canary' ? 45 : 10));
    c.classification = c.confidence >= 80 ? 'distributed_crawler_campaign' : c.confidence >= 45 ? 'probable_shared_crawler' : 'possible_campaign';
    this.store.stats.campaignCorrelations++;
    this.store.touchCampaign?.(id);
    this.log({ type:'campaign_correlation', campaignId:id, members:c.members.length, reason, confidence:c.confidence });
    return c;
  }
}

export function newCampaign(id) {
  return { id, firstSeen:0, lastSeen:0, confidence:0, classification:'possible_campaign', members:[], evidence:[] };
}

export function publicCampaign(c, publicIdForKey) {
  return { id:c.id, confidence:c.confidence, classification:c.classification, memberCount:c.members.length,
    members:c.members.slice(0,8).map(publicIdForKey), firstSeen:c.firstSeen, lastSeen:c.lastSeen, evidence:c.evidence.slice(-8) };
}
