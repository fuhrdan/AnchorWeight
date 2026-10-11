function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function levelFor(score) {
  if (score >= 85) return 'very_high';
  if (score >= 65) return 'high';
  if (score >= 40) return 'moderate';
  if (score >= 15) return 'low';
  return 'minimal';
}

function addReason(reasons, reason, points, detail = undefined) {
  const value = Math.max(0, Number(points) || 0);
  if (!value) return 0;
  reasons.push(detail === undefined ? { reason, points:value } : { reason, points:value, detail });
  return value;
}

function hasSignal(profile, name) {
  return Array.isArray(profile?.signalNames) && profile.signalNames.includes(name);
}

function identityClass(profile) {
  if (profile?.goodBotVerified) return 'verified_search_crawler';
  return profile?.agentIdentity?.current?.trafficClass || 'browser_or_unknown';
}

function publicBehavior(profile) {
  const state = profile?.agentBehavior || {};
  const observations = Math.max(0, Number(state.observations) || 0);
  const intervals = Array.isArray(state.intervalsMs)
    ? state.intervalsMs.filter(x => Number.isFinite(x) && x >= 0)
    : [];
  const averageIntervalMs = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : null;
  const currentBucket = Array.isArray(state.minuteBuckets) && state.minuteBuckets.length
    ? state.minuteBuckets[state.minuteBuckets.length - 1]
    : null;
  const apiRequests = Math.max(0, Number(state.apiRequests) || 0);
  const responses = Math.max(0, Number(state.responseObservations) || 0);
  const notFound = Math.max(0, Number(state.notFoundResponses) || 0);
  return {
    observations,
    averageIntervalMs,
    routeBreadth: Array.isArray(state.routeHashes) ? state.routeHashes.length : 0,
    uniqueUrlsCurrentMinute: Array.isArray(currentBucket?.routeHashes) ? currentBucket.routeHashes.length : 0,
    suspectedRetries: Math.max(0, Number(state.suspectedRetries) || 0),
    apiConcentrationPercent: observations ? Math.round((apiRequests / observations) * 100) : 0,
    responseObservations: responses,
    notFoundPercent: responses ? Math.round((notFound / responses) * 100) : 0,
    downloadResponses: Math.max(0, Number(state.downloadResponses) || 0),
    downloadBytesObserved: Math.max(0, Number(state.downloadBytesObserved) || 0)
  };
}

function automationDimension(profile) {
  const reasons = [];
  let score = 0;
  const trafficClass = identityClass(profile);
  const identityPoints = {
    verified_search_crawler: 95,
    declared_ai_crawler: 90,
    user_directed_agent: 85,
    unknown_automation: 70,
    browser_or_unknown: 0
  }[trafficClass] ?? 0;
  score += addReason(reasons, `identity_${trafficClass}`, identityPoints);

  if ((profile?.proofOfCrawl || 0) > 0) score += addReason(reasons, 'proof_of_crawl', 45);
  else if ((profile?.validTraversals || 0) > 0) score += addReason(reasons, 'signed_traversal', Math.min(35, 15 + (profile.validTraversals * 5)));
  if (hasSignal(profile, 'automation_user_agent')) score += addReason(reasons, 'automation_user_agent', 25);
  if (hasSignal(profile, 'missing_user_agent')) score += addReason(reasons, 'missing_user_agent', 8);
  if (hasSignal(profile, 'rapid_request_burst')) score += addReason(reasons, 'rapid_request_burst', 12);
  if ((profile?.userAgents || []).length > 2) score += addReason(reasons, 'user_agent_variation', 5);

  score = clampScore(score);
  return { score, level:levelFor(score), reasons:reasons.slice(0,8) };
}

function policyDimension(profile) {
  const reasons = [];
  if (profile?.manualPolicy === 'allow') {
    return { score:0, level:'minimal', reasons:[{reason:'manual_allow',points:0}] };
  }
  if (profile?.manualPolicy === 'quarantine') {
    return { score:100, level:'very_high', reasons:[{reason:'manual_quarantine',points:100}] };
  }

  let score = 0;
  const blackhole = Math.max(0, Number(profile?.blackholeVisits) || 0);
  if (blackhole) score += addReason(reasons, 'robots_disallowed_visit', Math.min(80, 60 + ((blackhole - 1) * 10)), { count:blackhole });

  const invalid = Math.max(0, Number(profile?.invalidTraversals) || 0);
  if (invalid) score += addReason(reasons, 'invalid_signed_traversal', Math.min(45, 15 + (invalid * 10)), { count:invalid });

  if (hasSignal(profile, 'spoofed_good_bot_claim')) score += addReason(reasons, 'spoofed_verified_crawler_claim', 35);

  const behavior = publicBehavior(profile);
  if (behavior.responseObservations >= 10 && behavior.notFoundPercent >= 50) {
    score += addReason(reasons, 'high_not_found_concentration', Math.min(20, Math.round((behavior.notFoundPercent - 40) / 3)), { percent:behavior.notFoundPercent });
  }
  if (behavior.observations >= 10 && behavior.suspectedRetries >= 5) {
    score += addReason(reasons, 'repeated_short_window_retries', Math.min(15, behavior.suspectedRetries), { count:behavior.suspectedRetries });
  }

  score = clampScore(score);
  return { score, level:levelFor(score), reasons:reasons.slice(0,8) };
}

function resourceDimension(profile) {
  const reasons = [];
  let score = 0;
  const behavior = publicBehavior(profile);

  if (behavior.averageIntervalMs !== null) {
    let points = 0;
    if (behavior.averageIntervalMs < 100) points = 40;
    else if (behavior.averageIntervalMs < 500) points = 30;
    else if (behavior.averageIntervalMs < 1000) points = 20;
    else if (behavior.averageIntervalMs < 5000) points = 10;
    score += addReason(reasons, 'request_velocity', points, { averageIntervalMs:Math.round(behavior.averageIntervalMs) });
  }

  if (behavior.uniqueUrlsCurrentMinute) {
    score += addReason(reasons, 'unique_urls_current_minute', Math.min(25, Math.ceil(behavior.uniqueUrlsCurrentMinute / 2)), { count:behavior.uniqueUrlsCurrentMinute });
  }
  if (behavior.routeBreadth >= 20) {
    score += addReason(reasons, 'broad_route_sweep', Math.min(15, Math.ceil(behavior.routeBreadth / 5)), { count:behavior.routeBreadth });
  }
  if (behavior.suspectedRetries) {
    score += addReason(reasons, 'short_window_retries', Math.min(15, behavior.suspectedRetries), { count:behavior.suspectedRetries });
  }
  if (behavior.observations >= 20 && behavior.apiConcentrationPercent >= 80) {
    score += addReason(reasons, 'sustained_api_concentration', 10, { percent:behavior.apiConcentrationPercent });
  }
  if (behavior.downloadBytesObserved > 0) {
    const mib = behavior.downloadBytesObserved / (1024 * 1024);
    score += addReason(reasons, 'download_bytes_observed', Math.min(20, Math.max(3, Math.ceil(mib / 5))), { bytes:behavior.downloadBytesObserved });
  } else if (behavior.downloadResponses >= 3) {
    score += addReason(reasons, 'repeated_download_responses', Math.min(10, behavior.downloadResponses), { count:behavior.downloadResponses });
  }

  score = clampScore(score);
  return { score, level:levelFor(score), reasons:reasons.slice(0,8) };
}

/**
 * Alpha.3 derived scoring. These scores are explanatory and observation-only.
 * Legacy `profile.score` remains the sole score-based enforcement source.
 */
export function scoreTrafficDimensions(profile) {
  return {
    version: 1,
    enforcement: 'legacy_score_only',
    automationConfidence: automationDimension(profile),
    policyRisk: policyDimension(profile),
    resourcePressure: resourceDimension(profile),
    legacy: {
      score: Math.max(0, Number(profile?.score) || 0),
      classification: profile?.classification || 'unknown'
    }
  };
}
