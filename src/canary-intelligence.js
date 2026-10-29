import crypto from 'node:crypto';

const FILE_TRAPS = new Map([
  ['/.enf', 'fake_env'],
  ['/.env.backup', 'env_backup'],
  ['/.env.production.old', 'env_production_old'],
  ['/config/secrets.backup', 'secrets_backup']
]);

const ROUTE_TRAPS = new Map([
  ['/_internal/export', 'internal_export'],
  ['/api/internal/debug', 'internal_debug'],
  ['/system/diagnostics/export', 'diagnostics_export'],
  ['/admin/config/archive', 'config_archive']
]);

const TOKEN_PREFIX = '/internal/bootstrap/';

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromB64url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(secret, value) {
  return crypto
    .createHmac('sha256', secret)
    .update(`anchorweight:canary:v1:${value}`)
    .digest('base64url');
}

function safeEqual(a, b) {
  try {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function subjectFor(secret, key) {
  return crypto
    .createHmac('sha256', secret)
    .update(`anchorweight:canary:subject:v1:${key}`)
    .digest('hex')
    .slice(0, 24);
}

function makeToken(config, key, trapId, now) {
  const scoped = Boolean(key);

  const payload = {
    v: 1,
    t: trapId,
    s: scoped ? subjectFor(config.secret, key) : null,
    u: !scoped,
    n: crypto.randomBytes(12).toString('hex'),
    e: now + (config.canaryTokenTtlSeconds * 1000)
  };

  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(config.secret, encoded)}`;
}

function verifyToken(config, token, now) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { valid:false, reason:'format' };

  const [encoded, signature] = parts;
  const expected = sign(config.secret, encoded);

  if (!safeEqual(signature, expected))
    return { valid:false, reason:'signature' };

  try {
    const payload = JSON.parse(fromB64url(encoded));

    if (payload?.v !== 1)
      return { valid:false, reason:'version' };

    if (!Number.isFinite(payload?.e) || payload.e < now)
      return { valid:false, reason:'expired', payload };

    return { valid:true, payload };
  } catch {
    return { valid:false, reason:'payload' };
  }
}

function parseCookies(req) {
  const result = {};
  const raw = String(req?.headers?.cookie || '');

  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    result[part.slice(0,index).trim()] = part.slice(index + 1).trim();
  }

  return result;
}

function automationScore(profile) {
  const candidates = [
    profile?.trafficScores?.automationConfidence?.score,
    profile?.assessment?.automationConfidence?.score,
    profile?.policyDecision?.automationConfidence,
    profile?.policyDecision?.scores?.automationConfidence
  ];

  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }

  return null;
}

function cookieValue(config, key, now) {
  const payload = {
    v: 1,
    s: subjectFor(config.secret, key),
    n: crypto.randomBytes(10).toString('hex'),
    e: now + (config.canaryCookieTtlSeconds * 1000)
  };

  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(config.secret, `cookie:${encoded}`)}`;
}

function verifyCookie(config, value, key, now) {
  const parts = String(value || '').split('.');
  if (parts.length !== 2) return { valid:false };

  const [encoded, signature] = parts;
  const expected = sign(config.secret, `cookie:${encoded}`);

  if (!safeEqual(signature, expected))
    return { valid:false };

  try {
    const payload = JSON.parse(fromB64url(encoded));

    if (payload?.v !== 1 || payload.e < now)
      return { valid:false };

    return {
      valid: payload.s === subjectFor(config.secret, key),
      shared: payload.s !== subjectFor(config.secret, key)
    };
  } catch {
    return { valid:false };
  }
}

function remember(profile, field, now) {
  profile.canaryIntelligence ||= {
    discoveries:0,
    consumptions:0,
    cookieObservations:0,
    sharedTokens:0,
    lastAt:null
  };

  profile.canaryIntelligence[field] =
    (profile.canaryIntelligence[field] || 0) + 1;

  profile.canaryIntelligence.lastAt = now;
}

function sendText(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  for (const [name,value] of Object.entries(headers))
    res.setHeader(name,value);

  res.end(body);
}

function sendJson(res, status, value, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  for (const [name,value] of Object.entries(headers))
    res.setHeader(name,value);

  res.end(JSON.stringify(value));
}

export function createCanaryIntelligence(config, {
  log = () => {},
  now = () => Date.now()
} = {}) {

  function maybeCookie(key, profile) {
    if (!config.canaryCookieEnabled) return null;

    const score = automationScore(profile);

    // Never fall back to legacy score. No explicit automation dimension means
    // no suspect-only cookie.
    if (score == null || score < config.canaryCookieThreshold)
      return null;

    const value = cookieValue(config,key,now());

    return `${config.canaryCookieName}=${value}; Path=/; Max-Age=${config.canaryCookieTtlSeconds}; HttpOnly; Secure; SameSite=Lax`;
  }

  async function handle(req, res, url, {
    key,
    profile,
    behavior,
    trusted = false
  } = {}) {
    if (!config.canaryEnabled)
      return { handled:false };

    const scoped = Boolean(key && profile);
    const at = now();

    // Degraded hosting identity may still receive inert Canary responses,
    // but it must never participate in client correlation or cookie state.
    const cookie = scoped
      ? parseCookies(req)[config.canaryCookieName]
      : null;

    if (cookie) {
      const state = verifyCookie(config,cookie,key,at);

      if (state.valid) {
        remember(profile,'cookieObservations',at);
        log({
          type:'canary_cookie_observed',
          ipKey:key
        });
      } else if (state.shared) {
        remember(profile,'sharedTokens',at);

        if (!trusted)
          behavior?.addSignal?.(
            key,
            'shared_canary_cookie',
            config.scoreSharedCanary
          );

        log({
          type:'canary_cookie_shared',
          ipKey:key
        });
      }
    }

    const pathname = url?.pathname || '/';

    if (config.canaryTokenTrapsEnabled && pathname.startsWith(TOKEN_PREFIX)) {
      const token = pathname.slice(TOKEN_PREFIX.length);
      const checked = verifyToken(config,token,at);

      if (!checked.valid) {
        log({
          type:'canary_token_invalid',
          ipKey:key,
          reason:checked.reason
        });

        sendJson(res,404,{error:'not_found'});
        return { handled:true, kind:'invalid_token' };
      }

      const tokenScoped =
        checked.payload.u !== true &&
        typeof checked.payload.s === 'string' &&
        checked.payload.s.length > 0;

      // A token created while identity was degraded stays unscoped forever.
      // Likewise, consuming a scoped token during a degraded request cannot
      // create shared-token evidence.
      const requestScoped = scoped && tokenScoped;
      const expectedSubject = requestScoped
        ? subjectFor(config.secret,key)
        : null;
      const shared = requestScoped
        ? checked.payload.s !== expectedSubject
        : false;

      if (requestScoped) {
        remember(profile,'consumptions',at);

        if (shared)
          remember(profile,'sharedTokens',at);

        if (!trusted) {
          behavior?.addSignal?.(
            key,
            shared ? 'shared_canary_token' : 'canary_token_consumed',
            shared
              ? config.scoreSharedCanary
              : config.scoreProofOfCrawl
          );

          behavior?.updatePolicyDecision?.(profile,at);
        }
      }

      log({
        type: requestScoped
          ? (shared ? 'canary_token_shared' : 'canary_token_consumed')
          : 'canary_token_consumed_unscoped',
        ipKey: requestScoped ? key : null,
        trapId:checked.payload.t,
        identityScoped:requestScoped,
        shadowMode:config.canaryShadowMode
      });

      const headers = {};
      const suspectCookie =
        requestScoped && !trusted ? maybeCookie(key,profile) : null;
      if (suspectCookie) headers['Set-Cookie'] = suspectCookie;

      sendJson(res,200,{
        ok:true,
        state:'ready',
        items:[]
      },headers);

      return {
        handled:true,
        kind: requestScoped
          ? (shared ? 'shared_token' : 'consumption')
          : 'consumption_unscoped'
      };
    }

    const fileTrap =
      config.canaryFileTrapsEnabled ? FILE_TRAPS.get(pathname) : null;

    const routeTrap =
      config.canaryRouteTrapsEnabled ? ROUTE_TRAPS.get(pathname) : null;

    const trapId = fileTrap || routeTrap;

    if (!trapId)
      return { handled:false };

    // Verified/explicitly allowed clients still receive inert bait, but no
    // behavioral penalty is applied.
    if (scoped && !trusted) {
      remember(profile,'discoveries',at);

      behavior?.noteLure?.(key);
      behavior?.updatePolicyDecision?.(profile,at);
    }

    log({
      type:'canary_discovery',
      ipKey: scoped ? key : null,
      trapId,
      path:pathname,
      trusted,
      identityScoped:scoped,
      shadowMode:config.canaryShadowMode
    });

    const headers = {};
    const suspectCookie =
      scoped && !trusted ? maybeCookie(key,profile) : null;
    if (suspectCookie) headers['Set-Cookie'] = suspectCookie;

    if (fileTrap) {
      const token = makeToken(config,scoped ? key : null,trapId,at);

      const body = [
        'APP_ENV=production',
        'CONFIG_MODE=managed',
        `INTERNAL_API_KEY=aw_canary_${token.slice(0,24)}`,
        `CONFIG_ENDPOINT=${TOKEN_PREFIX}${token}`,
        ''
      ].join('\n');

      sendText(res,200,body,headers);

      return {
        handled:true,
        kind:'discovery',
        trapId
      };
    }

    sendJson(res,200,{
      ok:true,
      export:'prepared',
      endpoint:`${TOKEN_PREFIX}${makeToken(config,scoped ? key : null,trapId,at)}`
    },headers);

    return {
      handled:true,
      kind:'discovery',
      trapId
    };
  }

  return {
    handle,
    verifyToken
  };
}
