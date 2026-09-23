import { newProfile, publicProfile } from './behavior.js';
import { newCampaign, publicCampaign } from './campaigns.js';

export class MemoryStore {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.sessions = new Map();
    this.blocks = new Map();
    this.offenses = new Map();
    this.profiles = new Map();
    this.campaigns = new Map();
    this.stats = {
      lureVisits: 0,
      blackholeVisits: 0,
      blackholeConvictions: 0,
      wouldBlackholeQuarantine: 0,
      validTraversals: 0,
      invalidTraversals: 0,
      wouldBlock: 0,
      blockedRequests: 0,
      quarantinedRequests: 0,
      behaviorSignals: 0,
      scoreConvictions: 0,
      campaignCorrelations: 0
    };
  }

  cleanup() {
    const now = this.now();
    for (const [id, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(id);
    for (const [ipKey, b] of this.blocks) if (b.until <= now) this.blocks.delete(ipKey);
  }

  createSession(id, data) { this.sessions.set(id, data); }
  getSession(id) { this.cleanup(); return this.sessions.get(id); }
  deleteSession(id) { this.sessions.delete(id); }

  getProfile(ipKey) {
    let p = this.profiles.get(ipKey);
    if (!p) {
      p = newProfile();
      this.profiles.set(ipKey, p);
    }
    return p;
  }

  touchProfile(_ipKey) {}

  getCampaign(id) { let c=this.campaigns.get(id); if(!c){ c=newCampaign(id); this.campaigns.set(id,c); } return c; }
  findCampaignByMember(key) { for (const c of this.campaigns.values()) if (c.members.includes(key)) return c; return null; }
  touchCampaign(_id) {}


  findProfileKeyById(botId) {
    const wanted = String(botId || '').trim().toUpperCase();
    for (const key of this.profiles.keys()) {
      if (`AW-${key.slice(0, 8).toUpperCase()}` === wanted) return key;
    }
    return null;
  }

  setManualPolicyById(botId, policy) {
    const key = this.findProfileKeyById(botId);
    if (!key) return null;
    const p = this.getProfile(key);
    p.manualPolicy = policy || null;
    this.touchProfile?.(key);
    return publicProfile(key, p);
  }

  /** An analyst review is metadata, not an automatic allow/quarantine decision. */
  setReviewById(botId, status, note = '') {
    const key = this.findProfileKeyById(botId);
    if (!key) return null;
    const p = this.getProfile(key);
    p.review = { status, note, at: new Date(this.now()).toISOString() };
    this.touchProfile?.(key);
    return publicProfile(key, p);
  }

  getPublicProfileById(botId) {
    const key = this.findProfileKeyById(botId);
    return key ? publicProfile(key, this.getProfile(key)) : null;
  }

  getPublicCampaignById(id) {
    const c = this.campaigns.get(String(id || '').trim().toUpperCase());
    return c ? publicCampaign(c, k => `AW-${k.slice(0,8).toUpperCase()}`) : null;
  }

  noteOffense(ipKey) {
    const count = (this.offenses.get(ipKey) || 0) + 1;
    this.offenses.set(ipKey, count);
    const profile = this.getProfile(ipKey);
    profile.offenseCount = count;
    profile.lastOffenseAt = this.now();
    this.touchProfile?.(ipKey);
    return count;
  }

  block(ipKey, minutes, reason) {
    const until = this.now() + minutes * 60_000;
    this.blocks.set(ipKey, { until, reason });
    return until;
  }

  isBlocked(ipKey) {
    this.cleanup();
    return this.blocks.get(ipKey) || null;
  }

  snapshot() {
    this.cleanup();
    const topProfiles = [...this.profiles.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 10)
      .map(([k, p]) => publicProfile(k, p));
    const profiles = [...this.profiles.values()];
    const topCampaigns = [...this.campaigns.values()].sort((a,b)=>b.confidence-a.confidence).slice(0,10).map(c=>publicCampaign(c,k=>`AW-${k.slice(0,8).toUpperCase()}`));
    return {
      ...this.stats,
      verifiedGoodBots: profiles.filter(p => p.goodBotVerified).length,
      spoofedGoodBotClaims: profiles.filter(p => p.goodBotClaimed && !p.goodBotVerified).length,
      manuallyAllowed: profiles.filter(p => p.manualPolicy === 'allow').length,
      manuallyQuarantined: profiles.filter(p => p.manualPolicy === 'quarantine').length,
      activeSessions: this.sessions.size,
      activeBlocks: this.blocks.size,
      trackedOffenders: this.offenses.size,
      trackedProfiles: this.profiles.size,
      trackedCampaigns: this.campaigns.size,
      topCampaigns,
      topProfiles
    };
  }
}
