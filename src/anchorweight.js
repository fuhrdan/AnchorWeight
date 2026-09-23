import { randomId, ipFingerprint, safeEqual } from './crypto.js';
import { MemoryStore } from './store.js';
import { createLogger, readEvents } from './logger.js';
import { childEntries, inspectChain } from './procedural.js';
import { noteEvidence } from './evidence.js';
import { renderDecoy } from './decoy.js';
import { BehaviorEngine } from './behavior.js';
import { GoodBotVerifier } from './goodbot.js';
import { AdminSecurity } from './admin-security.js';
import { createAuditLogger } from './audit.js';
import { CampaignEngine } from './campaigns.js';

function esc(s) {
  return String(s).replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[c]));
}

function rawIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function setCommon(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function html(res, status, body) {
  setCommon(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(body);
  return true;
}

function text(res, status, body) {
  setCommon(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
  return true;
}

function json(res, status, obj) {
  setCommon(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
  return true;
}

export function createAnchorWeight(config, deps = {}) {
  const store = deps.store || new MemoryStore(deps.now);
  const log = deps.log || createLogger(config.logFile, { maxMb: config.eventMaxMb, retentionDays: config.eventRetentionDays });
  const behavior = deps.behavior || new BehaviorEngine(config, store, log, deps.now);
  const goodBots = deps.goodBots || new GoodBotVerifier(config, deps.goodBotOptions || {});
  const campaigns = deps.campaigns || new CampaignEngine(config, store, log, deps.now);
  const admin = deps.admin || new AdminSecurity(config, deps.now);
  const audit = deps.audit || (config.auditEnabled === false ? (() => {}) : createAuditLogger(config.auditLogFile));

  function recordOffense(key) {
    const count = store.noteOffense(key);
    if (count > 1) noteEvidence(store, key, { kind:'repeat_offense', offenseCount: count });
    return count;
  }

  function ipKey(req) {
    return ipFingerprint(config.secret, rawIp(req, config.trustProxy));
  }

  async function preflight(req, res, url) {
    const key = ipKey(req);
    const profile = behavior.observeRequest(key, req, url);
    const botId = `AW-${key.slice(0, 8).toUpperCase()}`;
    const allowIds = new Set((config.allowBotIds || []).map(x => String(x).toUpperCase()));
    const quarantineIds = new Set((config.quarantineBotIds || []).map(x => String(x).toUpperCase()));
    if (allowIds.has(botId)) profile.manualPolicy = 'allow';
    else if (quarantineIds.has(botId)) profile.manualPolicy = 'quarantine';
    // Otherwise preserve an operator policy persisted in the profile store.

    const good = await goodBots.verify(rawIp(req, config.trustProxy), String(req.headers['user-agent'] || ''));
    behavior.noteGoodBot(key, good);

    // Explicit allow policy wins. Verified search crawlers are also trusted unless explicitly quarantined.
    if (profile.manualPolicy === 'allow' || (profile.goodBotVerified && profile.manualPolicy !== 'quarantine')) {
      log({ type: profile.manualPolicy === 'allow' ? 'manual_allow' : 'verified_good_bot', ipKey: key, provider: profile.goodBotProvider || null });
      return false;
    }

    let blocked = store.isBlocked(key);
    if (!blocked && profile.manualPolicy === 'quarantine') {
      store.stats.wouldBlock++;
      if (!config.shadowMode) store.block(key, config.blockMinutes, 'manual_quarantine');
      blocked = store.isBlocked(key);
      log({ type: config.shadowMode ? 'would_manual_quarantine' : 'manual_quarantine', ipKey: key });
    }

    if (!blocked && behavior.shouldQuarantine(key)) {
      const profile = store.getProfile(key);
      if (!profile.scoreConvicted) {
        profile.scoreConvicted = true;
        store.touchProfile?.(key);
        store.stats.scoreConvictions++;
        store.stats.wouldBlock++;
        const offenses = recordOffense(key);
        const minutes = offenses > 1 ? config.repeatBlockMinutes : config.blockMinutes;
        let until = null;
        if (!config.shadowMode) until = store.block(key, minutes, `behavior_score_${profile.score}`);
        log({ type: config.shadowMode ? 'would_block_score' : 'block_score', ipKey: key, score: profile.score, offenses, minutes, until });
        blocked = store.isBlocked(key);
      }
    }

    if (!blocked || config.shadowMode) return false;

    store.stats.blockedRequests++;

    if (config.quarantineMode === 'decoy') {
      store.stats.quarantinedRequests++;
      log({ type: 'quarantine_decoy', ipKey: key, path: url?.pathname || '/', reason: blocked.reason });
      const decoy = renderDecoy(config, key, url || new URL('http://localhost/'), req);
      setCommon(res);
      res.statusCode = 200;
      res.setHeader('Content-Type', decoy.type);
      if (req.method === 'HEAD') res.end(); else res.end(decoy.body);
      return true;
    }

    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((blocked.until - Date.now()) / 1000))));
    text(res, 429, 'Request temporarily blocked by site policy.');
    return true;
  }

  function handle(req, res, url) {
    const method = req.method || 'GET';
    const isPolicyPost = method === 'POST' && url.pathname === `${config.basePath}/api/policy`;
    if (!['GET', 'HEAD'].includes(method) && !isPolicyPost) return text(res, 405, 'Method not allowed');

    if (url.pathname.startsWith(`${config.basePath}/api/`)) {
      if (!config.dashboardEnabled) return text(res, 404, 'Not found');
      if (!admin.authenticate(req, url, safeEqual)) {
        const failedRate = admin.rateLimit(req, 'failed_auth');
        if (!failedRate.allowed) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil(failedRate.resetMs / 1000))));
          audit({ type:'admin_auth_rate_limited', client:admin.clientKey(req), path:url.pathname });
          return json(res, 429, { error:'admin_auth_rate_limited' });
        }
        audit({ type:'admin_auth_failed', client:admin.clientKey(req), path:url.pathname });
        return text(res, 401, 'Unauthorized');
      }
      const rate = admin.rateLimit(req, 'authenticated');
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(rate.resetMs / 1000))));
        audit({ type:'admin_rate_limited', client: admin.clientKey(req), path:url.pathname });
        return json(res, 429, { error:'admin_rate_limited' });
      }

      if (url.pathname === `${config.basePath}/api/session`) {
        const csrfToken = admin.issueCsrf(req);
        return json(res, 200, { version:'1.3.0', csrfToken, expiresInSeconds:(config.csrfTtlMinutes || 15) * 60 });
      }

      if (url.pathname === `${config.basePath}/api/stats` || url.pathname === `${config.basePath}/api/stats/`) {
        return json(res, 200, { version: '1.3.0', mode: config.shadowMode ? 'shadow' : 'enforce', blockDepth: config.blockDepth, scoreEnforcementEnabled: !!config.scoreEnforcementEnabled, quarantineScore: config.quarantineScore ?? 100, ...store.snapshot() });
      }

      if (url.pathname === `${config.basePath}/api/events`) {
        const events = readEvents(config.logFile, {
          limit: url.searchParams.get('limit') || 100,
          type: url.searchParams.get('type') || '',
          botId: url.searchParams.get('bot') || '',
          campaignId: url.searchParams.get('campaign') || '',
          search: url.searchParams.get('q') || ''
        });
        return json(res, 200, { version:'1.3.0', events });
      }

      if (url.pathname === `${config.basePath}/api/investigate`) {
        const botId = url.searchParams.get('bot') || '';
        const campaignId = url.searchParams.get('campaign') || '';
        const profile = botId ? store.getPublicProfileById?.(botId) : null;
        const campaign = campaignId ? store.getPublicCampaignById?.(campaignId) : null;
        const events = readEvents(config.logFile, { limit: 200, botId, campaignId });
        return json(res, 200, { profile, campaign, events });
      }

      if (url.pathname === `${config.basePath}/api/policy`) {
        if (req.method !== 'POST') return text(res, 405, 'Method not allowed');
        if (!admin.validateCsrf(req)) {
          audit({ type:'admin_csrf_failed', client:admin.clientKey(req), path:url.pathname });
          return json(res, 403, { error:'csrf_required' });
        }
        let body = '';
        let tooLarge = false;
        req.on('data', chunk => {
          if (tooLarge) return;
          if (Buffer.byteLength(body, 'utf8') + chunk.length > config.adminBodyMaxBytes) {
            tooLarge = true;
            return json(res, 413, { error:'request_body_too_large' });
          }
          body += chunk;
        });
        req.on('end', () => {
          if (tooLarge) return;
          try {
            const parsed = JSON.parse(body || '{}');
            const botId = String(parsed.botId || '').trim().toUpperCase();
            const policy = parsed.policy == null || parsed.policy === '' ? null : String(parsed.policy);
            if (!/^AW-[A-Z0-9_-]{8}$/.test(botId)) return json(res, 400, { error:'invalid_bot_id' });
            if (![null, 'allow', 'quarantine'].includes(policy)) return json(res, 400, { error:'invalid_policy' });
            const profile = store.setManualPolicyById?.(botId, policy);
            if (!profile) return json(res, 404, { error:'profile_not_found' });
            log({ type:'operator_policy_change', botId, policy:policy || 'clear' });
            audit({ type:'operator_policy_change', botId, policy:policy || 'clear', client:admin.clientKey(req) });
            return json(res, 200, { ok:true, profile });
          } catch {
            return json(res, 400, { error:'invalid_json' });
          }
        });
        return true;
      }

      return text(res, 404, 'Not found');
    }

    if (config.blackholeEnabled && url.pathname === config.blackholePath) {
      return robotsBlackhole(req, res);
    }

    if (url.pathname === config.basePath || url.pathname === `${config.basePath}/`) {
      return newLure(req, res);
    }

    const prefix = `${config.basePath}/t/`;
    if (!url.pathname.startsWith(prefix)) return text(res, 404, 'Not found');

    // A malformed escape or enormous caller-supplied path must not become an HTTP 500
    // or an unbounded cryptographic loop.
    if (url.pathname.length > 512) return text(res, 404, 'Not found');
    let rest;
    try { rest = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent); }
    catch { return text(res, 404, 'Not found'); }
    if (rest.length < 2 || rest.length > config.blockDepth + 3 || !/^[A-Za-z0-9_-]{8,64}$/.test(rest[0])) return text(res, 404, 'Not found');
    const [sid, ...tokens] = rest;
    return traverse(req, res, sid, tokens);
  }

  function robotsBlackhole(req, res) {
    const key = ipKey(req);
    const profile = store.getProfile(key);
    store.stats.blackholeVisits = (store.stats.blackholeVisits || 0) + 1;

    if (profile.manualPolicy === 'allow' || profile.goodBotVerified) {
      log({ type:'trusted_blackhole_ignored', ipKey:key, provider:profile.goodBotProvider || null });
      return html(res, 200, '<!doctype html><html><head><meta name="robots" content="noindex,nofollow,noarchive"><title>Archive</title></head><body><h1>Archive</h1><p>No indexed resources are available here.</p></body></html>');
    }

    behavior.noteBlackhole(key);
    noteEvidence(store, key, { kind:'blackhole', reason:'robots_blackhole_violation' });
    store.stats.blackholeConvictions = (store.stats.blackholeConvictions || 0) + 1;
    store.stats.wouldBlock++;
    const offenses = recordOffense(key);
    const minutes = offenses > 1 ? config.repeatBlockMinutes : config.blockMinutes;
    let until = null;

    if (config.shadowMode) {
      store.stats.wouldBlackholeQuarantine = (store.stats.wouldBlackholeQuarantine || 0) + 1;
    } else {
      until = store.block(key, minutes, 'robots_blackhole_violation');
    }

    log({
      type: config.shadowMode ? 'would_block_blackhole' : 'block_blackhole',
      ipKey:key, offenses, minutes, until, path:config.blackholePath
    });

    return html(res, 200, '<!doctype html><html><head><meta name="robots" content="noindex,nofollow,noarchive"><title>Archive</title></head><body><h1>Archive</h1><p>This archive entry is unavailable.</p></body></html>');
  }

  function newLure(req, res) {
    const sid = randomId();
    const key = ipKey(req);
    const profile = store.getProfile(key);
    if (profile.goodBotVerified || profile.manualPolicy === 'allow') {
      log({ type: 'trusted_bot_lure_ignored', ipKey: key, provider: profile.goodBotProvider || null });
      return html(res, 200, '<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>Archive</title></head><body><h1>Archive</h1><p>No indexed resources are available here.</p></body></html>');
    }
    const now = Date.now();
    store.createSession(sid, { ipKey: key, lastDepth: 0, createdAt: now, expiresAt: now + config.sessionTtlMinutes * 60_000, branches: [], lastHopAt: now });
    store.stats.lureVisits++;
    behavior.noteLure(key);
    noteEvidence(store, key, { kind:'lure', sid });
    log({ type: 'lure', sid, ipKey: key });
    const children = childEntries(config.secret, sid, [], config.branchCount, config.canaryVariantsEnabled !== false);
    return html(res, 200, renderIndex(config, sid, [], children[0], children));
  }

  function traverse(req, res, sid, tokens) {
    const depth = tokens.length;
    const key = ipKey(req);
    const s = store.getSession(sid);
    // Authenticate the COMPLETE path before attributing it to another client.
    // A guessed/observed SID without signed tokens is not campaign evidence.
    const branches = s ? inspectChain(config.secret, sid, tokens, config.branchCount, config.canaryVariantsEnabled !== false) : null;
    const branch = branches?.at(-1);
    const elapsedMs = s ? Math.max(0, Date.now() - (s.lastHopAt || s.createdAt)) : null;
    let reason = '';
    if (!s) reason = 'unknown_or_expired_session';
    else if (depth < 1 || depth > config.blockDepth + 2) reason = 'depth_out_of_range';
    else if (!branches) reason = 'bad_chain';
    else if (config.sessionBindIp && s.ipKey !== key) reason = 'session_ip_mismatch';
    else if (depth !== s.lastDepth + 1) reason = 'non_sequential';

    if (reason) {
      store.stats.invalidTraversals++;
      behavior.noteInvalidTraversal(key, reason);
      noteEvidence(store, key, { kind:'invalid_traversal', sid, reason, depth, ...(branch === undefined ? {} : { branch }) });
      if (reason === 'session_ip_mismatch' && s?.ipKey && branches) {
        const c = campaigns.correlate(s.ipKey, key, 'shared_signed_canary', { sid, depth, branch });
        if (c) {
          for (const member of c.members) {
            const mp = store.getProfile(member);
            mp.campaignIds ||= [];
            if (!mp.campaignIds.includes(c.id)) mp.campaignIds.push(c.id);
            store.touchProfile?.(member);
          }
          behavior.addSignalOnce(key, 'shared_signed_canary', config.scoreSharedCanary ?? 20, { campaignId:c.id });
        }
      }
      log({ type: 'invalid_traversal', sid, ipKey: key, depth, reason, ...(branch === undefined ? {} : { branch }) });
      return text(res, 404, 'Not found');
    }

    const now = Date.now();
    s.lastDepth = depth;
    s.expiresAt = now + config.sessionTtlMinutes * 60_000;
    s.lastHopAt = now;
    s.branches ||= [];
    s.branches.push(branch);
    store.stats.validTraversals++;
    behavior.noteTraversal(key, depth, sid);
    noteEvidence(store, key, { kind:'traversal', sid, depth, branch, elapsedMs });
    // Retain just the branch path, never URL query strings or signed token text.
    log({ type: 'traversal', sid, ipKey: key, depth, branch, elapsedMs, branchPath: s.branches.slice() });

    if (depth >= config.blockDepth) {
      behavior.noteProof(key, depth);
      noteEvidence(store, key, { kind:'proof_of_crawl', sid, depth, branch });
      const offenses = recordOffense(key);
      const minutes = offenses > 1 ? config.repeatBlockMinutes : config.blockMinutes;
      store.stats.wouldBlock++;
      let until = null;
      if (!config.shadowMode) until = store.block(key, minutes, `proof_of_crawl_depth_${depth}`);
      store.deleteSession(sid);
      log({ type: config.shadowMode ? 'would_block' : 'block', sid, ipKey: key, depth, offenses, minutes, until, branchPath: s.branches.slice() });
      return html(res, 200, renderTerminal(depth, config.shadowMode, config.quarantineMode));
    }

    const children = childEntries(config.secret, sid, tokens, config.branchCount, config.canaryVariantsEnabled !== false);
    return html(res, 200, renderIndex(config, sid, tokens, children[0], children));
  }

  return { preflight, handle, store, behavior, goodBots, campaigns, admin };
}

function renderIndex(config, sid, tokens, child, entries) {
  const rows = entries.map((e, i) => {
    const nextTokens = [...tokens, e.token];
    const nextPath = `${config.basePath}/t/${encodeURIComponent(sid)}/${nextTokens.map(encodeURIComponent).join('/')}`;
    const href = config.canaryVariantsEnabled === false && i ? `${nextPath}?view=${i}` : nextPath;
    return `<li><a href="${esc(href)}">${esc(e.name)}/</a></li>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Index of /</title></head><body><h1>Index of /</h1><ul>${rows}</ul><hr><small>nginx</small></body></html>`;
}

function renderTerminal(depth, shadow, quarantineMode) {
  if (shadow) return `<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>Index</title></head><body><h1>Index unavailable</h1><p>Traversal recorded at depth ${depth}.</p></body></html>`;
  if (quarantineMode === 'decoy') return '<!doctype html><html><head><meta name="robots" content="noindex,nofollow,noarchive"><title>Archive</title></head><body><h1>Archive</h1><p>This resource is currently available in read-only mode.</p></body></html>';
  return '<!doctype html><html><head><title>Too Many Requests</title></head><body><h1>429</h1><p>Automated recursive traversal was detected and temporarily blocked.</p></body></html>';
}
