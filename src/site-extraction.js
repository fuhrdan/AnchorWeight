import crypto from 'node:crypto';

const MAX_ROUTE_FAMILIES = 64;
const MAX_MINUTE_BUCKETS = 5;
const MAX_REASONS = 10;

function clamp(value, min, max)
{
  return Math.max(min, Math.min(max, value));
}

function shortHash(secret, value)
{
  const key = String(secret || 'anchorweight-site-extraction');
  return crypto.createHmac('sha256', key).update(String(value || '')).digest('hex').slice(0, 16);
}

function pathnameOf(url)
{
  return url && typeof url.pathname === 'string' ? (url.pathname || '/') : '/';
}

function routeShape(pathname)
{
  return String(pathname || '/')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/ig, ':uuid')
    .replace(/\b[0-9a-f]{16,}\b/ig, ':hex')
    .replace(/\b\d+\b/g, ':n')
    .replace(/\/[^/]{24,}(?=\/|$)/g, '/:slug');
}

function isAssetPath(pathname)
{
  return /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav)(?:$|\/)/i.test(pathname);
}

function isDocumentLike(req, pathname)
{
  const method = String(req?.method || 'GET').toUpperCase();
  if (!['GET','HEAD'].includes(method)) return false;
  if (isAssetPath(pathname)) return false;
  return true;
}

function explicitToolUa(ua)
{
  return /(?:^|[\s/(])(?:curl|wget|python-requests|httpie|libwww-perl|go-http-client|powershell)(?:[\/\s)]|$)/i.test(String(ua || ''));
}

function hasBrowserFetchSignals(req)
{
  const h = req?.headers || {};
  return !!(h['sec-fetch-dest'] || h['sec-fetch-mode'] || h['sec-fetch-site'] || h['sec-ch-ua']);
}

function genericAccept(req)
{
  const accept = String(req?.headers?.accept || '').trim().toLowerCase();
  return !accept || accept === '*/*';
}

function freshState()
{
  return {
    version: 1,
    observations: 0,
    firstAt: null,
    lastAt: null,
    documentLikeRequests: 0,
    assetRequests: 0,
    queryBearingRequests: 0,
    numericPatternRequests: 0,
    genericAcceptRequests: 0,
    explicitToolUaRequests: 0,
    browserFetchSignalRequests: 0,
    routeFamilyHashes: [],
    minuteBuckets: [],
    score: 0,
    level: 'none',
    likelyBulkScrape: false,
    highConfidenceBulkScrape: false,
    reasons: [],
    lastEvaluatedAt: null
  };
}

function ensureState(profile)
{
  if (!profile.siteExtraction || typeof profile.siteExtraction !== 'object')
    profile.siteExtraction = freshState();

  const state = profile.siteExtraction;
  for (const [key, value] of Object.entries(freshState()))
  {
    if (state[key] === undefined)
      state[key] = Array.isArray(value) ? [] : (value && typeof value === 'object' ? {} : value);
  }
  return state;
}

function pushUniqueBounded(array, value, max)
{
  if (!array.includes(value)) array.push(value);
  while (array.length > max) array.shift();
}

function currentMinuteBucket(state, now)
{
  const minute = Math.floor(now / 60_000);
  let bucket = state.minuteBuckets[state.minuteBuckets.length - 1];
  if (!bucket || bucket.minute !== minute)
  {
    bucket = {
      minute,
      requests: 0,
      documentLikeRequests: 0,
      numericPatternRequests: 0,
      genericAcceptRequests: 0,
      explicitToolUaRequests: 0,
      browserFetchSignalRequests: 0,
      routeFamilyHashes: []
    };
    state.minuteBuckets.push(bucket);
    while (state.minuteBuckets.length > MAX_MINUTE_BUCKETS) state.minuteBuckets.shift();
  }
  return bucket;
}

function behaviorSnapshot(profile)
{
  const behavior = profile?.agentBehavior || {};
  const observations = Math.max(0, Number(behavior.observations) || 0);
  const minuteBuckets = Array.isArray(behavior.minuteBuckets) ? behavior.minuteBuckets : [];
  const current = minuteBuckets.length ? minuteBuckets[minuteBuckets.length - 1] : null;
  const intervals = Array.isArray(behavior.intervalsMs)
    ? behavior.intervalsMs.filter(x => Number.isFinite(x) && x >= 0)
    : [];
  let regularityPercent = null;
  let averageIntervalMs = null;

  if (intervals.length)
  {
    const mean = intervals.reduce((a,b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum,x) => sum + ((x - mean) ** 2), 0) / intervals.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : null;
    averageIntervalMs = Math.round(mean);
    if (intervals.length >= 3 && cv !== null)
      regularityPercent = Math.round(clamp(1 - cv, 0, 1) * 100);
  }

  const routeBreadth5m = new Set();
  for (const bucket of minuteBuckets.slice(-5))
  {
    for (const hash of Array.isArray(bucket?.routeHashes) ? bucket.routeHashes : [])
    {
      routeBreadth5m.add(String(hash));
      if (routeBreadth5m.size >= 320) break;
    }
  }

  const cookieSeen = Math.max(0, Number(behavior.cookieObservations) || 0);
  const cookieMissing = Math.max(0, Number(behavior.noCookieObservations) || 0);
  const cookieTotal = cookieSeen + cookieMissing;
  const responses = Math.max(0, Number(behavior.responseObservations) || 0);
  const notFound = Math.max(0, Number(behavior.notFoundResponses) || 0);

  return {
    observations,
    routeBreadth: Array.isArray(behavior.routeHashes) ? behavior.routeHashes.length : 0,
    routeBreadth5m: routeBreadth5m.size,
    requestsCurrentMinute: Math.max(0, Number(current?.requests) || 0),
    uniqueUrlsCurrentMinute: Array.isArray(current?.routeHashes) ? current.routeHashes.length : 0,
    cookiePresencePercent: cookieTotal ? Math.round((cookieSeen / cookieTotal) * 100) : null,
    averageIntervalMs,
    regularityPercent,
    responseObservations: responses,
    notFoundPercent: responses ? Math.round((notFound / responses) * 100) : 0,
    downloadResponses: Math.max(0, Number(behavior.downloadResponses) || 0),
    downloadBytesObserved: Math.max(0, Number(behavior.downloadBytesObserved) || 0)
  };
}

function addReason(reasons, code, points, detail = undefined)
{
  const value = Math.max(0, Math.round(Number(points) || 0));
  if (!value) return 0;
  reasons.push(detail === undefined ? { code, points:value } : { code, points:value, detail });
  return value;
}

function assess(profile, state, now)
{
  const behavior = behaviorSnapshot(profile);
  const current = state.minuteBuckets[state.minuteBuckets.length - 1] || {};
  const observations = Math.max(state.observations || 0, behavior.observations || 0);
  const reasons = [];
  let score = 0;

  const uniqueMinute = behavior.uniqueUrlsCurrentMinute;
  const rpm = behavior.requestsCurrentMinute;
  const uniqueRatio = rpm ? uniqueMinute / rpm : 0;

  if (uniqueMinute >= 30)
    score += addReason(reasons, 'high_unique_url_breadth', 20, { count:uniqueMinute });
  else if (uniqueMinute >= 15)
    score += addReason(reasons, 'high_unique_url_breadth', 10, { count:uniqueMinute });

  if (rpm >= 15 && uniqueRatio >= 0.75)
    score += addReason(reasons, 'high_unique_url_ratio', 15, { percent:Math.round(uniqueRatio * 100) });

  if (behavior.routeBreadth5m >= 80)
    score += addReason(reasons, 'sustained_route_breadth_5m', 20, { count:behavior.routeBreadth5m });
  else if (behavior.routeBreadth5m >= 40)
    score += addReason(reasons, 'sustained_route_breadth_5m', 12, { count:behavior.routeBreadth5m });
  else if (behavior.routeBreadth5m >= 20)
    score += addReason(reasons, 'sustained_route_breadth_5m', 6, { count:behavior.routeBreadth5m });

  const lifetimeUniqueRatio = observations ? behavior.routeBreadth / Math.min(observations, 64) : 0;
  if (behavior.routeBreadth >= 50 && lifetimeUniqueRatio >= 0.75)
    score += addReason(reasons, 'broad_unique_content_walk', 20, { count:behavior.routeBreadth });
  else if (behavior.routeBreadth >= 30 && lifetimeUniqueRatio >= 0.70)
    score += addReason(reasons, 'broad_unique_content_walk', 12, { count:behavior.routeBreadth });

  const familyCount = Array.isArray(current.routeFamilyHashes) ? current.routeFamilyHashes.length : 0;
  if (uniqueMinute >= 12 && familyCount > 0 && familyCount <= Math.max(3, Math.ceil(uniqueMinute / 5)))
    score += addReason(reasons, 'enumeration_shape_concentration', 15, { uniqueUrls:uniqueMinute, routeFamilies:familyCount });

  if ((current.numericPatternRequests || 0) >= 5 && uniqueMinute >= 10)
    score += addReason(reasons, 'numeric_resource_enumeration', 8, { count:current.numericPatternRequests });

  if (observations >= 20 && behavior.cookiePresencePercent !== null && behavior.cookiePresencePercent <= 10)
    score += addReason(reasons, 'minimal_cookie_continuity', 10, { percent:behavior.cookiePresencePercent });

  const documentRatio = observations ? (state.documentLikeRequests || 0) / observations : 0;
  if (observations >= 20 && documentRatio >= 0.80)
    score += addReason(reasons, 'document_heavy_collection', 8, { percent:Math.round(documentRatio * 100) });

  const genericRatio = observations ? (state.genericAcceptRequests || 0) / observations : 0;
  const browserSignalRatio = observations ? (state.browserFetchSignalRequests || 0) / observations : 0;
  if (observations >= 15 && genericRatio >= 0.80 && browserSignalRatio <= 0.10)
    score += addReason(reasons, 'non_browser_request_shape', 8, {
      genericAcceptPercent:Math.round(genericRatio * 100),
      browserFetchSignalPercent:Math.round(browserSignalRatio * 100)
    });

  if ((state.explicitToolUaRequests || 0) >= 3)
    score += addReason(reasons, 'repeated_command_line_client_declaration', 8, { count:state.explicitToolUaRequests });

  if (behavior.averageIntervalMs !== null &&
      behavior.averageIntervalMs <= 2000 &&
      behavior.regularityPercent !== null &&
      behavior.regularityPercent >= 70)
  {
    score += addReason(reasons, 'machine_regular_request_timing', 8, {
      averageIntervalMs:behavior.averageIntervalMs,
      regularityPercent:behavior.regularityPercent
    });
  }

  if (behavior.responseObservations >= 10 && behavior.notFoundPercent >= 20)
    score += addReason(reasons, 'enumeration_not_found_pattern', 10, { percent:behavior.notFoundPercent });

  if (behavior.downloadBytesObserved >= 20 * 1024 * 1024 || behavior.downloadResponses >= 5)
    score += addReason(reasons, 'bulk_download_behavior', 8, {
      responses:behavior.downloadResponses,
      bytes:behavior.downloadBytesObserved
    });

  score = clamp(score, 0, 100);

  let level = 'none';
  if (score >= 80) level = 'high_confidence_bulk_scrape';
  else if (score >= 60) level = 'likely_bulk_scrape';
  else if (score >= 45) level = 'elevated';
  else if (score >= 25) level = 'watch';

  state.score = score;
  state.level = level;
  state.likelyBulkScrape = score >= 60;
  state.highConfidenceBulkScrape = score >= 80;
  state.reasons = reasons.sort((a,b) => b.points - a.points).slice(0, MAX_REASONS);
  state.lastEvaluatedAt = Number(now) || null;
  return state;
}

/**
 * v3.2 alpha.1 bulk-scrape/site-extraction observation.
 *
 * This module intentionally cannot block, throttle, quarantine, mutate legacy
 * score, or write Policy Engine inputs. It stores only bounded counters and
 * keyed hashes of normalized route families; raw paths, queries, cookies and
 * User-Agent values are never retained.
 */
export function observeSiteExtraction(profile, req, url, { now = Date.now(), secret = '' } = {})
{
  const state = ensureState(profile);
  const pathname = pathnameOf(url);
  const bucket = currentMinuteBucket(state, now);
  const ua = String(req?.headers?.['user-agent'] || '');

  state.observations++;
  state.firstAt ??= now;
  state.lastAt = now;
  bucket.requests++;

  if (isAssetPath(pathname))
  {
    state.assetRequests++;
  }
  else if (isDocumentLike(req, pathname))
  {
    state.documentLikeRequests++;
    bucket.documentLikeRequests++;
  }

  const shapeHash = shortHash(secret, `route-family:${routeShape(pathname)}`);
  pushUniqueBounded(state.routeFamilyHashes, shapeHash, MAX_ROUTE_FAMILIES);
  pushUniqueBounded(bucket.routeFamilyHashes, shapeHash, MAX_ROUTE_FAMILIES);

  if (url?.search)
    state.queryBearingRequests++;

  if (/\d/.test(pathname))
  {
    state.numericPatternRequests++;
    bucket.numericPatternRequests++;
  }

  if (genericAccept(req))
  {
    state.genericAcceptRequests++;
    bucket.genericAcceptRequests++;
  }

  if (explicitToolUa(ua))
  {
    state.explicitToolUaRequests++;
    bucket.explicitToolUaRequests++;
  }

  if (hasBrowserFetchSignals(req))
  {
    state.browserFetchSignalRequests++;
    bucket.browserFetchSignalRequests++;
  }

  assess(profile, state, now);
  return publicSiteExtraction(profile);
}

export function refreshSiteExtraction(profile, { now = Date.now() } = {})
{
  const state = ensureState(profile);
  assess(profile, state, now);
  return publicSiteExtraction(profile);
}

export function publicSiteExtraction(profile)
{
  const state = ensureState(profile);
  const behavior = behaviorSnapshot(profile);
  return {
    version: 1,
    observationOnly: true,
    enforcement: false,
    observations: state.observations || 0,
    firstAt: state.firstAt ?? null,
    lastAt: state.lastAt ?? null,
    score: clamp(state.score || 0, 0, 100),
    level: ['none','watch','elevated','likely_bulk_scrape','high_confidence_bulk_scrape'].includes(state.level)
      ? state.level : 'none',
    likelyBulkScrape: !!state.likelyBulkScrape,
    highConfidenceBulkScrape: !!state.highConfidenceBulkScrape,
    evidence: {
      routeBreadth: behavior.routeBreadth,
      routeBreadth5m: behavior.routeBreadth5m,
      uniqueUrlsCurrentMinute: behavior.uniqueUrlsCurrentMinute,
      requestsCurrentMinute: behavior.requestsCurrentMinute,
      routeFamilyCount: (state.routeFamilyHashes || []).length,
      documentLikeRequests: state.documentLikeRequests || 0,
      assetRequests: state.assetRequests || 0,
      queryBearingRequests: state.queryBearingRequests || 0,
      numericPatternRequests: state.numericPatternRequests || 0,
      explicitToolUaRequests: state.explicitToolUaRequests || 0,
      browserFetchSignalRequests: state.browserFetchSignalRequests || 0,
      cookiePresencePercent: behavior.cookiePresencePercent,
      averageIntervalMs: behavior.averageIntervalMs,
      timingRegularityPercent: behavior.regularityPercent,
      notFoundPercent: behavior.notFoundPercent,
      downloadResponses: behavior.downloadResponses,
      downloadBytesObserved: behavior.downloadBytesObserved
    },
    reasons: Array.isArray(state.reasons)
      ? state.reasons.slice(0, MAX_REASONS).map(x => ({
          code:String(x?.code || 'unknown').slice(0,64),
          points:Math.max(0, Math.round(Number(x?.points) || 0)),
          ...(x?.detail === undefined ? {} : { detail:x.detail })
        }))
      : [],
    privacy: {
      rawPathRetained: false,
      rawQueryRetained: false,
      rawCookieRetained: false,
      rawUserAgentRetained: false
    }
  };
}

export function emptySiteExtraction()
{
  return freshState();
}
