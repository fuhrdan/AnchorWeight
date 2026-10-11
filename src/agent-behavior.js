import crypto from 'node:crypto';

const MAX_ROUTE_HASHES = 64;
const MAX_MINUTE_BUCKETS = 5;
const MAX_RECENT_REQUESTS = 32;
const MAX_INTERVALS = 32;
const MAX_COOKIE_HASHES = 8;
const RETRY_WINDOW_MS = 10_000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shortHash(secret, value) {
  const key = String(secret || 'anchorweight-agent-behavior');
  return crypto.createHmac('sha256', key).update(String(value || '')).digest('hex').slice(0, 16);
}

function pathnameOf(url) {
  if (url && typeof url.pathname === 'string') return url.pathname || '/';
  return '/';
}

function routeDepth(pathname) {
  return pathname.split('/').filter(Boolean).length;
}

function isApiPath(pathname) {
  return /(?:^|\/)(?:api|graphql)(?:\/|$)/i.test(pathname);
}

function isDownloadIntent(req, pathname) {
  const ext = pathname.toLowerCase();
  if (/\.(?:zip|7z|rar|gz|tgz|bz2|xz|pdf|docx?|xlsx?|pptx?|csv|iso|dmg|exe|msi|apk|bin|tar)(?:$|\/)/.test(ext)) return true;
  const accept = String(req?.headers?.accept || '').toLowerCase();
  return accept.includes('application/octet-stream') || accept.includes('application/zip') || accept.includes('application/pdf');
}

function freshState() {
  return {
    observations: 0,
    firstAt: null,
    lastAt: null,
    routeHashes: [],
    minuteBuckets: [],
    maxNavigationDepth: 0,
    methodCounts: {},
    recentRequests: [],
    suspectedRetries: 0,
    cookieObservations: 0,
    noCookieObservations: 0,
    cookieHashes: [],
    apiRequests: 0,
    downloadIntentRequests: 0,
    responseObservations: 0,
    notFoundResponses: 0,
    downloadResponses: 0,
    downloadBytesObserved: 0,
    downloadBytesKnownResponses: 0,
    intervalsMs: []
  };
}

function ensureState(profile) {
  if (!profile.agentBehavior || typeof profile.agentBehavior !== 'object') profile.agentBehavior = freshState();
  const state = profile.agentBehavior;
  for (const [key, value] of Object.entries(freshState())) {
    if (state[key] === undefined) state[key] = Array.isArray(value) ? [] : (value && typeof value === 'object' ? {} : value);
  }
  return state;
}

function pushBounded(array, value, max) {
  array.push(value);
  while (array.length > max) array.shift();
}

function currentMinuteBucket(state, now) {
  const minute = Math.floor(now / 60_000);
  let bucket = state.minuteBuckets[state.minuteBuckets.length - 1];
  if (!bucket || bucket.minute !== minute) {
    bucket = { minute, routeHashes: [] };
    state.minuteBuckets.push(bucket);
    while (state.minuteBuckets.length > MAX_MINUTE_BUCKETS) state.minuteBuckets.shift();
  }
  return bucket;
}

function timingSummary(state) {
  const intervals = (state.intervalsMs || []).filter(x => Number.isFinite(x) && x >= 0);
  if (!intervals.length) return { samples:0, averageIntervalMs:null, minIntervalMs:null, regularityPercent:null };
  const mean = intervals.reduce((a,b)=>a+b,0) / intervals.length;
  const variance = intervals.reduce((sum,x)=>sum + ((x - mean) ** 2),0) / intervals.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : null;
  const regularity = intervals.length >= 3 && cv !== null ? Math.round(clamp(1 - cv, 0, 1) * 100) : null;
  return {
    samples: intervals.length,
    averageIntervalMs: Math.round(mean),
    minIntervalMs: Math.min(...intervals),
    regularityPercent: regularity
  };
}

function safeContentLength(res) {
  const value = res?.getHeader?.('content-length');
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function responseLooksDownload(res) {
  const type = String(res?.getHeader?.('content-type') || '').toLowerCase();
  const disposition = String(res?.getHeader?.('content-disposition') || '').toLowerCase();
  return disposition.includes('attachment') || type.includes('application/octet-stream') || type.includes('application/zip') || type.includes('application/pdf');
}

/**
 * Observation-only request behavior. No score, classification, policy or enforcement mutation.
 * Raw paths, queries and cookies are never retained.
 */
export function observeAgentBehavior(profile, req, url, { now = Date.now(), secret = '' } = {}) {
  const state = ensureState(profile);
  const pathname = pathnameOf(url);
  const method = String(req?.method || 'GET').toUpperCase();
  const routeHash = shortHash(secret, `route:${pathname}`);
  const requestHash = shortHash(secret, `request:${method}:${pathname}`);

  if (state.lastAt !== null && Number.isFinite(state.lastAt)) {
    pushBounded(state.intervalsMs, Math.max(0, now - state.lastAt), MAX_INTERVALS);
  }

  state.observations++;
  state.firstAt ??= now;
  state.lastAt = now;
  state.methodCounts[method] = (state.methodCounts[method] || 0) + 1;
  state.maxNavigationDepth = Math.max(state.maxNavigationDepth || 0, routeDepth(pathname));

  if (!state.routeHashes.includes(routeHash)) {
    pushBounded(state.routeHashes, routeHash, MAX_ROUTE_HASHES);
  }

  const bucket = currentMinuteBucket(state, now);
  if (!bucket.routeHashes.includes(routeHash)) pushBounded(bucket.routeHashes, routeHash, MAX_ROUTE_HASHES);

  const previous = [...state.recentRequests].reverse().find(item => item.requestHash === requestHash);
  if (previous && now - previous.at <= RETRY_WINDOW_MS) state.suspectedRetries++;
  pushBounded(state.recentRequests, { requestHash, at:now }, MAX_RECENT_REQUESTS);

  const cookie = req?.headers?.cookie;
  if (typeof cookie === 'string' && cookie.length) {
    state.cookieObservations++;
    const cookieHash = shortHash(secret, `cookie:${cookie}`);
    if (!state.cookieHashes.includes(cookieHash)) pushBounded(state.cookieHashes, cookieHash, MAX_COOKIE_HASHES);
  } else {
    state.noCookieObservations++;
  }

  if (isApiPath(pathname)) state.apiRequests++;
  if (isDownloadIntent(req, pathname)) state.downloadIntentRequests++;

  return publicAgentBehavior(profile);
}

/** Observation-only response metrics. Intended to run from the response finish hook. */
export function observeAgentResponse(profile, req, res, url, { now = Date.now() } = {}) {
  const state = ensureState(profile);
  state.responseObservations++;
  const status = Number(res?.statusCode || 0);
  if (status === 404) state.notFoundResponses++;

  if (responseLooksDownload(res)) {
    state.downloadResponses++;
    const length = safeContentLength(res);
    if (length !== null) {
      state.downloadBytesObserved += length;
      state.downloadBytesKnownResponses++;
    }
  }

  state.lastResponseAt = now;
  return publicAgentBehavior(profile);
}

export function publicAgentBehavior(profile) {
  const state = ensureState(profile);
  const currentBucket = state.minuteBuckets[state.minuteBuckets.length - 1];
  const observations = state.observations || 0;
  const timing = timingSummary(state);
  const get = state.methodCounts.GET || 0;
  const head = state.methodCounts.HEAD || 0;
  const api = state.apiRequests || 0;
  const cookieSeen = state.cookieObservations || 0;
  const noCookie = state.noCookieObservations || 0;
  const cookieTotal = cookieSeen + noCookie;
  const robotsRequests = profile.robotsRequests || 0;
  const blackholeVisits = profile.blackholeVisits || 0;

  return {
    observations,
    firstAt: state.firstAt ?? null,
    lastAt: state.lastAt ?? null,
    routeBreadth: (state.routeHashes || []).length,
    uniqueUrlsCurrentMinute: currentBucket?.routeHashes?.length || 0,
    maxNavigationDepth: state.maxNavigationDepth || 0,
    methods: { GET:get, HEAD:head, other:Math.max(0, observations - get - head) },
    headToGetRatio: get ? Number((head / get).toFixed(3)) : (head ? null : 0),
    suspectedRetries: state.suspectedRetries || 0,
    cookieContinuity: {
      withCookie: cookieSeen,
      withoutCookie: noCookie,
      cookieVariants: (state.cookieHashes || []).length,
      presencePercent: cookieTotal ? Math.round((cookieSeen / cookieTotal) * 100) : null
    },
    apiRequests: api,
    apiConcentrationPercent: observations ? Math.round((api / observations) * 100) : 0,
    downloadIntentRequests: state.downloadIntentRequests || 0,
    responses: {
      observed: state.responseObservations || 0,
      notFound: state.notFoundResponses || 0,
      notFoundPercent: state.responseObservations ? Math.round(((state.notFoundResponses || 0) / state.responseObservations) * 100) : 0,
      downloadResponses: state.downloadResponses || 0,
      downloadBytesObserved: state.downloadBytesObserved || 0,
      downloadBytesKnownResponses: state.downloadBytesKnownResponses || 0
    },
    robots: {
      requests: robotsRequests,
      disallowedVisits: blackholeVisits,
      compliance: blackholeVisits > 0 ? 'violation_observed' : (robotsRequests > 0 ? 'no_violation_observed' : 'unknown')
    },
    lureBehavior: {
      lureVisits: profile.lureVisits || 0,
      validTraversals: profile.validTraversals || 0,
      invalidTraversals: profile.invalidTraversals || 0,
      proofOfCrawl: profile.proofOfCrawl || 0,
      maxDepth: profile.maxDepth || 0,
      traversalStyle: profile.traversalStyle || 'unknown'
    },
    timing
  };
}

export function emptyAgentBehavior() {
  return freshState();
}
