import crypto from 'node:crypto';
import { assessProfile } from './assessment.js';
import { assessClientEnvironment } from './client-environment.js';
import { createAdaptiveDeception } from './adaptive-deception.js';
import { createAdaptiveIntervention } from './adaptive-intervention.js';

function shortHash(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value || '')).digest('hex').slice(0, 12);
}

function looksAutomated(ua) {
  return /bot|crawler|spider|scrape|curl|wget|python-requests|httpclient|go-http-client|headless/i.test(ua || '');
}

export class BehaviorEngine {
  constructor(config, store, log = () => {}, now = () => Date.now()) {
    this.config = config;
    this.store = store;
    this.log = log;
    this.now = now;
    this.adaptiveDeception = createAdaptiveDeception(config, log, now);
    this.adaptiveIntervention = createAdaptiveIntervention(config, log, now);
  }

  observeRequest(ipKey, req, url) {
    const now = this.now();
    const ua = String(req.headers['user-agent'] || '');
    const uaHash = shortHash(this.config.secret, ua || '(none)');
    const acceptHash = shortHash(this.config.secret, req.headers.accept || '');
    const p = this.store.getProfile(ipKey);
    const lastAt = p.lastSeen || 0;

    p.requestCount++;
    p.lastSeen = now;
    if (!p.firstSeen) p.firstSeen = now;
    p.methods[req.method || 'GET'] = (p.methods[req.method || 'GET'] || 0) + 1;
    p.acceptSignatures[acceptHash] = (p.acceptSignatures[acceptHash] || 0) + 1;

    // The TLS terminator, not this HTTP server, must produce JA4-compatible
    // metadata. Only accept the dedicated header when explicitly enabled AND
    // an overwriting trusted reverse proxy is configured. Never retain raw JA4.
    if (this.config.trustProxy && this.config.trustedJa4Enabled) {
      const ja4 = req.headers['x-aw-ja4'];
      if (typeof ja4 === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(ja4)) {
        p.trustedTlsFingerprints ||= [];
        const fingerprint = shortHash(this.config.secret, `ja4:${ja4}`);
        if (!p.trustedTlsFingerprints.includes(fingerprint)) {
          p.trustedTlsFingerprints.push(fingerprint);
          if (p.trustedTlsFingerprints.length > 8) p.trustedTlsFingerprints.shift();
        }
      }
    }

    if (!p.userAgents.includes(uaHash)) {
      if (p.userAgents.length > 0) this.addSignal(ipKey, 'user_agent_changed', this.config.scoreUaChange, { uaHash });
      p.userAgents.push(uaHash);
      if (p.userAgents.length > 8) p.userAgents.shift();
    }

    if (!ua) this.addSignalOnce(ipKey, 'missing_user_agent', this.config.scoreMissingUa);
    if (looksAutomated(ua)) this.addSignalOnce(ipKey, 'automation_user_agent', this.config.scoreAutomationUa);

    if (lastAt) {
      const delta = now - lastAt;
      p.intervalCount++;
      p.intervalTotalMs += delta;
      p.minIntervalMs = p.minIntervalMs == null ? delta : Math.min(p.minIntervalMs, delta);
      if (delta <= this.config.rapidRequestMs) p.rapidRequestCount++;
      else p.rapidRequestCount = 0;
      if (p.rapidRequestCount >= this.config.rapidRequestBurst) {
        this.addSignalOnce(ipKey, 'rapid_request_burst', this.config.scoreRapidBurst, { deltaMs: delta });
      }
    }

    if (url?.pathname === '/robots.txt') p.robotsRequests++;
    this.store.touchProfile?.(ipKey);
    return p;
  }

  noteLure(ipKey) {
    const p = this.store.getProfile(ipKey);
    p.lureVisits++;
    this.addSignal(ipKey, 'lure_discovered', this.config.scoreLure);
  }

  noteBlackhole(ipKey) {
    const p = this.store.getProfile(ipKey);
    p.blackholeVisits = (p.blackholeVisits || 0) + 1;
    this.addSignal(ipKey, 'robots_blackhole_violation', this.config.scoreBlackhole ?? 100);
    const adaptive = this.adaptiveDeception.observe(p, { kind:'blackhole' });
    this.adaptiveIntervention.observe(p, { kind:'blackhole' }, adaptive.recommendation);
  }

  noteTraversal(ipKey, depth, sessionId = '') {
    const p = this.store.getProfile(ipKey);
    p.validTraversals++;
    p.maxDepth = Math.max(p.maxDepth, depth);
    if (sessionId) p.trapSessions[sessionId] = Math.max(p.trapSessions[sessionId] || 0, depth);
    p.recentTraversalDepths.push(depth);
    if (p.recentTraversalDepths.length > 16) p.recentTraversalDepths.shift();
    p.traversalStyle = inferTraversalStyle(p);
    this.addSignal(ipKey, `valid_traversal_depth_${depth}`, this.config.scoreTraversal);
    const adaptive = this.adaptiveDeception.observe(p, { kind:'traversal', depth });
    this.adaptiveIntervention.observe(p, { kind:'traversal', depth }, adaptive.recommendation);
  }

  noteInvalidTraversal(ipKey, reason) {
    const p = this.store.getProfile(ipKey);
    p.invalidTraversals++;
    const adaptive = this.adaptiveDeception.observe(p, { kind:'invalid_traversal', reason });
    this.adaptiveIntervention.observe(p, { kind:'invalid_traversal', reason }, adaptive.recommendation);
    if (['bad_chain', 'non_sequential', 'session_ip_mismatch'].includes(reason)) {
      this.addSignalOnce(ipKey, `invalid_${reason}`, this.config.scoreInvalidTraversal, { reason });
    }
  }

  noteProof(ipKey, depth) {
    const p = this.store.getProfile(ipKey);
    p.proofOfCrawl++;
    p.maxDepth = Math.max(p.maxDepth, depth);
    this.addSignal(ipKey, 'proof_of_crawl', this.config.scoreProofOfCrawl, { depth });
    const adaptive = this.adaptiveDeception.observe(p, { kind:'proof_of_crawl', depth });
    this.adaptiveIntervention.observe(p, { kind:'proof_of_crawl', depth }, adaptive.recommendation);
  }

  addSignalOnce(ipKey, signal, points, detail = {}) {
    const p = this.store.getProfile(ipKey);
    if (p.signalNames.includes(signal)) return p.score;
    return this.addSignal(ipKey, signal, points, detail);
  }

  addSignal(ipKey, signal, points, detail = {}) {
    const p = this.store.getProfile(ipKey);
    const value = Math.max(0, Number(points) || 0);
    p.score = Math.min(1000, p.score + value);
    if (!p.signalNames.includes(signal)) p.signalNames.push(signal);
    p.signals.push({ at: this.now(), signal, points: value, ...detail });
    if (p.signals.length > 32) p.signals.shift();
    p.classification = classify(p);
    this.store.stats.behaviorSignals++;
    this.store.touchProfile?.(ipKey);
    this.log({ type: 'behavior_signal', ipKey, signal, points: value, score: p.score });
    return p.score;
  }

  noteClientEnvironment(ipKey, input) {
    const p = this.store.getProfile(ipKey);
    p.displayFingerprints ||= [];
    p.clientEnvironment ||= { observations:0, lastAt:null, lastReasons:[] };
    const assessment = assessClientEnvironment(input, {
      secret:this.config.secret,
      previousFingerprints:p.displayFingerprints
    });
    p.clientEnvironment.observations++;
    p.clientEnvironment.lastAt=this.now();
    p.clientEnvironment.lastReasons=assessment.reasons.slice(0,8);
    if (!p.displayFingerprints.includes(assessment.fingerprint)) {
      p.displayFingerprints.push(assessment.fingerprint);
      if (p.displayFingerprints.length > 4) p.displayFingerprints.shift();
    }
    for (const reason of assessment.reasons) {
      const configured = {
        screen_api_unavailable:this.config.scoreDisplayMissing,
        display_values_missing:this.config.scoreDisplayMissing,
        display_dimensions_invalid:this.config.scoreDisplayImpossible,
        available_area_exceeds_screen:this.config.scoreDisplayImpossible,
        viewport_materially_exceeds_screen:this.config.scoreDisplayImpossible,
        device_pixel_ratio_invalid:this.config.scoreDisplayImpossible,
        orientation_dimension_mismatch:this.config.scoreDisplayMismatch,
        unusual_color_depth:this.config.scoreDisplayUnusual,
        unusual_aspect_ratio:this.config.scoreDisplayUnusual,
        unusual_small_screen:this.config.scoreDisplayUnusual,
        display_fingerprint_changed_repeatedly:this.config.scoreDisplayChange
      }[reason.reason];
      this.addSignalOnce(ipKey, `client_env_${reason.reason}`, configured ?? reason.points, { fingerprint:assessment.fingerprint });
    }
    this.store.stats.clientEnvironmentObservations = (this.store.stats.clientEnvironmentObservations || 0) + 1;
    this.store.touchProfile?.(ipKey);
    return assessment;
  }

  noteGoodBot(ipKey, result) {
    const p = this.store.getProfile(ipKey);
    p.goodBotClaimed = !!result?.claimed;
    p.goodBotVerified = !!result?.verified;
    p.goodBotProvider = result?.provider || null;
    p.goodBotCheckReason = result?.reason || null;
    if (result?.claimed && !result?.verified) this.addSignalOnce(ipKey, 'spoofed_good_bot_claim', this.config.scoreSpoofedGoodBot, { provider: result.provider, reason: result.reason });
    p.classification = classify(p);
    this.store.touchProfile?.(ipKey);
  }

  shouldQuarantine(ipKey) {
    const p = this.store.getProfile(ipKey);
    return this.config.scoreEnforcementEnabled && p.score >= this.config.quarantineScore;
  }
}

export function newProfile() {
  return {
    firstSeen: 0, lastSeen: 0, requestCount: 0, lureVisits: 0, blackholeVisits: 0,
    validTraversals: 0, invalidTraversals: 0, proofOfCrawl: 0, maxDepth: 0,
    score: 0, classification: 'unknown', scoreConvicted: false, signalNames: [], signals: [],
    userAgents: [], methods: {}, acceptSignatures: {}, robotsRequests: 0,
    intervalCount: 0, intervalTotalMs: 0, minIntervalMs: null, rapidRequestCount: 0,
    goodBotClaimed: false, goodBotVerified: false, goodBotProvider: null, goodBotCheckReason: null, manualPolicy: null,
    trapSessions: {}, recentTraversalDepths: [], traversalStyle: 'unknown', campaignIds: [],
    offenseCount: 0, lastOffenseAt: null, evidence: [], trustedTlsFingerprints: [],
    displayFingerprints: [], clientEnvironment: { observations:0, lastAt:null, lastReasons:[] },
    adaptiveDeception: { observations:0, interventions:0, lastAt:null, lastIntervention:null, history:[], attackerCost:{requestsDiverted:0,shadowTraversals:0,decoyInteractions:0,additionalDepth:0,estimatedDelayMs:0,originRequestsPrevented:0} },
    adaptiveIntervention: { decisions:0,switches:0,lastAt:null,lastDecision:null,lastReason:null,pending:null,history:[],effectiveness:{} }
  };
}

export function publicProfile(ipKey, p) {
  return {
    id: `AW-${ipKey.slice(0, 8).toUpperCase()}`,
    score: p.score,
    classification: classify(p),
    requestCount: p.requestCount,
    lureVisits: p.lureVisits,
    blackholeVisits: p.blackholeVisits || 0,
    validTraversals: p.validTraversals,
    invalidTraversals: p.invalidTraversals,
    proofOfCrawl: p.proofOfCrawl,
    maxDepth: p.maxDepth,
    userAgentVariants: p.userAgents.length,
    robotsRequests: p.robotsRequests,
    averageIntervalMs: p.intervalCount ? Math.round(p.intervalTotalMs / p.intervalCount) : null,
    minIntervalMs: p.minIntervalMs,
    goodBot: { claimed: !!p.goodBotClaimed, verified: !!p.goodBotVerified, provider: p.goodBotProvider || null },
    manualPolicy: p.manualPolicy || null,
    traversalStyle: p.traversalStyle || inferTraversalStyle(p),
    campaignIds: (p.campaignIds || []).slice(0,8),
    offenseCount: p.offenseCount || 0,
    review: p.review || null,
    lastOffenseAt: p.lastOffenseAt || null,
    evidence: (p.evidence || []).slice(-12),
    clientEnvironment: { observations:p.clientEnvironment?.observations || 0, fingerprintVariants:(p.displayFingerprints || []).length, lastReasons:(p.clientEnvironment?.lastReasons || []).slice(0,8) },
    adaptiveDeception: { observations:p.adaptiveDeception?.observations||0, interventions:p.adaptiveDeception?.interventions||0, lastAt:p.adaptiveDeception?.lastAt||null, lastIntervention:p.adaptiveDeception?.lastIntervention||null, attackerCost:{...(p.adaptiveDeception?.attackerCost||{})}, history:(p.adaptiveDeception?.history||[]).slice(-12) },
    adaptiveIntervention: { decisions:p.adaptiveIntervention?.decisions||0, switches:p.adaptiveIntervention?.switches||0, lastAt:p.adaptiveIntervention?.lastAt||null, lastDecision:p.adaptiveIntervention?.lastDecision||null, lastReason:p.adaptiveIntervention?.lastReason||null, effectiveness:{...(p.adaptiveIntervention?.effectiveness||{})}, history:(p.adaptiveIntervention?.history||[]).slice(-12) },
    assessment: assessProfile(p),
    signals: p.signals.slice(-10)
  };
}

function classify(p) {
  if (p.manualPolicy === 'allow') return 'manually_allowed';
  if (p.manualPolicy === 'quarantine') return 'manually_quarantined';
  if (p.goodBotVerified) return `verified_${p.goodBotProvider || 'good'}_bot`;
  if (p.goodBotClaimed && !p.goodBotVerified) return 'spoofed_good_bot_claim';
  if (p.proofOfCrawl > 0 || p.score >= 100) return 'confirmed_recursive_crawler';
  if (p.score >= 70) return 'high_risk_automation';
  if (p.score >= 40) return 'suspicious_automation';
  if (p.score >= 15) return 'possible_automation';
  return 'unknown';
}


function inferTraversalStyle(p) {
  const sessions = Object.values(p.trapSessions || {});
  const deep = sessions.filter(d => d >= 2).length;
  if (sessions.length >= 2 && deep >= 1) return 'mixed_multi_session';
  if (p.maxDepth >= 2 && p.validTraversals >= 2) return 'depth_first';
  if (p.lureVisits >= 2 && p.maxDepth <= 1) return 'breadth_or_restart';
  return p.validTraversals ? 'probing' : 'unknown';
}
