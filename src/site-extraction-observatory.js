const LEVELS = Object.freeze([
  'none',
  'watch',
  'elevated',
  'likely_bulk_scrape',
  'high_confidence_bulk_scrape'
]);

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 25;
const RECENT_WINDOW_MS = 5 * 60_000;

function clampInt(value, min, max)
{
  const n = Math.round(Number(value) || 0);
  return Math.max(min, Math.min(max, n));
}

function safeLevel(value)
{
  return LEVELS.includes(value) ? value : 'none';
}

function safeTime(value)
{
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function candidate(profile)
{
  const x = profile?.siteExtraction || {};
  const evidence = x.evidence || {};
  return {
    id: String(profile?.id || 'unknown').slice(0, 32),
    score: clampInt(x.score, 0, 100),
    level: safeLevel(x.level),
    observations: Math.max(0, Math.round(Number(x.observations) || 0)),
    lastAt: safeTime(x.lastAt),
    likelyBulkScrape: !!x.likelyBulkScrape,
    highConfidenceBulkScrape: !!x.highConfidenceBulkScrape,
    evidence: {
      routeBreadth: Math.max(0, Math.round(Number(evidence.routeBreadth) || 0)),
      routeBreadth5m: Math.max(0, Math.round(Number(evidence.routeBreadth5m) || 0)),
      uniqueUrlsCurrentMinute: Math.max(0, Math.round(Number(evidence.uniqueUrlsCurrentMinute) || 0)),
      requestsCurrentMinute: Math.max(0, Math.round(Number(evidence.requestsCurrentMinute) || 0)),
      routeFamilyCount: Math.max(0, Math.round(Number(evidence.routeFamilyCount) || 0)),
      notFoundPercent: clampInt(evidence.notFoundPercent, 0, 100),
      downloadResponses: Math.max(0, Math.round(Number(evidence.downloadResponses) || 0)),
      downloadBytesObserved: Math.max(0, Math.round(Number(evidence.downloadBytesObserved) || 0))
    },
    reasons: Array.isArray(x.reasons)
      ? x.reasons.slice(0, 6).map(reason => ({
          code: String(reason?.code || 'unknown').slice(0, 64),
          points: clampInt(reason?.points, 0, 100)
        }))
      : []
  };
}

/**
 * Aggregate only the already-sanitized public Site Extraction projection.
 * No raw paths, queries, cookies, User-Agents, IP addresses, or route-family
 * hashes are accepted into this observatory.
 */
export function buildSiteExtractionObservatory(publicProfiles = [], {
  now = Date.now(),
  limit = DEFAULT_LIMIT
} = {})
{
  const profiles = Array.isArray(publicProfiles) ? publicProfiles : [];
  const cap = clampInt(limit, 1, MAX_LIMIT);
  const levels = Object.fromEntries(LEVELS.map(level => [level, 0]));
  const reasonCounts = new Map();
  const candidates = [];
  let observedProfiles = 0;
  let recentProfiles = 0;
  let totalScore = 0;
  let likelyBulkScrape = 0;
  let highConfidenceBulkScrape = 0;

  for (const profile of profiles)
  {
    const x = profile?.siteExtraction;
    if (!x || typeof x !== 'object') continue;

    const c = candidate(profile);
    observedProfiles++;
    totalScore += c.score;
    levels[c.level]++;

    if (c.likelyBulkScrape) likelyBulkScrape++;
    if (c.highConfidenceBulkScrape) highConfidenceBulkScrape++;

    if (c.lastAt !== null)
    {
      const age = Number(now) - c.lastAt;
      if (age >= 0 && age <= RECENT_WINDOW_MS) recentProfiles++;
    }

    for (const reason of c.reasons)
      reasonCounts.set(reason.code, (reasonCounts.get(reason.code) || 0) + 1);

    if (c.score > 0 || c.observations > 0)
      candidates.push(c);
  }

  candidates.sort((a, b) =>
    b.score - a.score ||
    Number(b.highConfidenceBulkScrape) - Number(a.highConfidenceBulkScrape) ||
    Number(b.likelyBulkScrape) - Number(a.likelyBulkScrape) ||
    (b.lastAt || 0) - (a.lastAt || 0) ||
    a.id.localeCompare(b.id));

  const topReasons = Object.fromEntries(
    [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
  );

  return {
    version: 1,
    observationOnly: true,
    enforcement: false,
    trackedProfiles: profiles.length,
    observedProfiles,
    recentProfiles,
    likelyBulkScrape,
    highConfidenceBulkScrape,
    averageScore: observedProfiles ? Math.round(totalScore / observedProfiles) : 0,
    maxScore: candidates.length ? candidates[0].score : 0,
    levels,
    thresholds: {
      watch: 25,
      elevated: 45,
      likelyBulkScrape: 60,
      highConfidenceBulkScrape: 80
    },
    topReasons,
    topCandidates: candidates.slice(0, cap),
    privacy: {
      publicProfilesOnly: true,
      rawPathRetained: false,
      rawQueryRetained: false,
      rawCookieRetained: false,
      rawUserAgentRetained: false,
      rawIpRetained: false,
      routeFamilyHashesExposed: false
    }
  };
}
