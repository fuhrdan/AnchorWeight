/**
 * Bot DNA 2.0: a derived, non-scoring explanation of observed behavior.
 * These are observations, NOT a determination that a person is malicious.
 * Avoid persistently duplicating derived fields; v1.3 state remains compatible.
 */
export function assessProfile(p) {
  const names = new Set(p.signalNames || []);
  const automation = [
    'automation_user_agent', 'missing_user_agent', 'rapid_request_burst',
    'user_agent_changed'
  ].filter(name => names.has(name));
  const verified = [];
  if ((p.validTraversals || 0) > 0) verified.push('signed_traversal');
  if ((p.proofOfCrawl || 0) > 0) verified.push('proof_of_crawl');
  if ((p.blackholeVisits || 0) > 0) verified.push('robots_disallowed_path');
  if ((p.campaignIds || []).length > 0) verified.push('signed_canary_correlation');
  const identity = p.goodBotVerified ? 'verified_search_crawler'
    : p.goodBotClaimed ? 'unverified_search_crawler_claim' : 'unverified';
  const tls = Array.isArray(p.trustedTlsFingerprints) ? p.trustedTlsFingerprints : [];
  return {
    automationObserved: automation.length > 0 || verified.length > 0,
    automationIndicators: automation,
    trapEvidence: verified,
    identity,
    tlsFingerprint: {
      available: tls.length > 0,
      source: tls.length > 0 ? 'trusted_proxy' : null,
      variantsObserved: tls.length,
      // A missing fingerprint is simply missing data, never a risk point.
      missingIsSuspicious: false
    },
    limitations: [
      'Automated does not necessarily mean malicious',
      'User-agent and ordinary HTTP headers can be changed by a client',
      'A shared network address does not establish a single actor'
    ]
  };
}
