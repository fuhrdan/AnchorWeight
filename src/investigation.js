/**
 * Investigation Console 2.0.
 *
 * Cases are bounded, read-only views of existing Bot DNA and campaign evidence.
 * They are NOT a second enforcement engine. An analyst's review is a separate,
 * explicitly recorded action, and never silently changes the site policy.
 *
 * Only public profile/campaign projections and redacted events cross the API.
 */
import { readEvents } from './logger.js';

const BOT_ID = /^AW-[A-Z0-9_-]{8}$/;
const CAMPAIGN_ID = /^AWC-[A-F0-9]{8}$/;
const MAX_TIMELINE = 200;
const REVIEW_STATUSES = new Set(['needs_review', 'false_positive', 'confirmed_automation', 'inconclusive']);

export function parseCaseQuery(params, { allowEmpty = false } = {}) {
  const botId = String(params.get('bot') || '').trim().toUpperCase();
  const campaignId = String(params.get('campaign') || '').trim().toUpperCase();
  if ((!botId && !campaignId && !allowEmpty) || (botId && campaignId)) {
    throw new RangeError('select_exactly_one_case');
  }
  if (botId && !BOT_ID.test(botId)) throw new RangeError('invalid_bot_id');
  if (campaignId && !CAMPAIGN_ID.test(campaignId)) throw new RangeError('invalid_campaign_id');
  const from = parseBoundary(params.get('from'), 'invalid_from');
  const to = parseBoundary(params.get('to'), 'invalid_to');
  if (from && to && from > to) throw new RangeError('invalid_time_window');
  const limitValue = params.get('limit');
  const limit = limitValue === null ? MAX_TIMELINE : Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TIMELINE) throw new RangeError('invalid_limit');
  const type = String(params.get('type') || '').trim();
  const search = String(params.get('q') || '').trim();
  if (type.length > 64 || search.length > 120) throw new RangeError('filter_too_long');
  return { botId, campaignId, from, to, limit, type, search };
}

function parseBoundary(value, error) {
  if (!value) return null;
  if (value.length > 35) throw new RangeError(error);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(error);
  return new Date(parsed).toISOString();
}

function filterEvents(events, options) {
  return events.filter(e => {
    const at = Date.parse(e.ts);
    if (!Number.isFinite(at)) return false;
    if (options.from && at < Date.parse(options.from)) return false;
    if (options.to && at > Date.parse(options.to)) return false;
    if (options.type && e.type !== options.type) return false;
    if (options.search && !JSON.stringify(e).toLowerCase().includes(options.search.toLowerCase())) return false;
    return true;
  });
}

/** Returns chronological events from an upper-bounded recent sample. */
export function buildInvestigation(store, logFile, options) {
  const { botId, campaignId, limit } = options;
  const profile = botId ? store.getPublicProfileById?.(botId) || null : null;
  const campaign = campaignId ? store.getPublicCampaignById?.(campaignId) || null : null;
  // Do not derive a relationship from a score or a shared IP prefix.
  const relatedCampaigns = profile ? (profile.campaignIds || []).map(id => store.getPublicCampaignById?.(id)).filter(Boolean) : [];
  const memberProfiles = campaign ? (campaign.members || []).map(id => store.getPublicProfileById?.(id)).filter(Boolean) : [];
  const candidates = campaign
    ? [readEvents(logFile, { limit:500, campaignId }),
      ...(campaign.members || []).map(id => readEvents(logFile, { limit:500, botId:id }))].flat()
    : readEvents(logFile, { limit:500, botId });
  const seen = new Set();
  const allMatching = filterEvents(candidates, options).filter(event => {
    const id = JSON.stringify(event);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).sort((a,b) => Date.parse(a.ts) - Date.parse(b.ts));
  const truncated = allMatching.length > limit;
  const events = allMatching.slice(-limit);
  return {
    version:'1.6.0', kind:campaignId ? 'campaign' : 'bot',
    caseId:campaignId || botId, profile, campaign, relatedCampaigns, memberProfiles,
    // events stays newest-first for v1.4 API compatibility; timeline is chronological.
    events:[...events].reverse(), timeline:events,
    eventCount:events.length, truncated,
    limitations:[
      'Events are limited to the current retained log and may omit rotated or expired records.',
      'Campaign relationships are based on documented signed-canary correlations, not proof of common ownership.',
      'Automation observations do not by themselves establish malicious intent.'
    ]
  };
}

export function buildCaseReport(investigation) {
  return {
    format:'anchorweight-investigation-v1', generatedAt:new Date().toISOString(),
    version:'1.6.0', caseId:investigation.caseId, kind:investigation.kind,
    profile:investigation.profile, campaign:investigation.campaign,
    relatedCampaigns:investigation.relatedCampaigns,
    memberProfiles:investigation.memberProfiles,
    timeline:investigation.timeline, eventCount:investigation.eventCount,
    truncated:investigation.truncated, limitations:investigation.limitations,
    // No private key, raw IP, bearer token or signed canary child token is included.
  };
}

export function formatCaseReportText(report) {
  const lines = [
    'ANCHORWEIGHT INVESTIGATION REPORT',
    `Generated: ${report.generatedAt}`,
    `Case: ${report.caseId} (${report.kind})`,
    `Events in this report: ${report.eventCount}${report.truncated?' (bounded sample)':''}`,
    '', 'ASSESSMENT',
    `Classification: ${report.profile?.classification || report.campaign?.classification || 'unknown'}`,
    `Review: ${report.profile?.review?.status || 'not reviewed'}`,
    `Review note: ${report.profile?.review?.note || 'none'}`,
    `Policy: ${report.profile?.manualPolicy || 'automatic'}`,
    `Trap evidence: ${(report.profile?.assessment?.trapEvidence || []).join(', ') || 'none recorded'}`,
    `Campaign evidence: ${(report.campaign?.evidence || []).map(e => e.reason).join(', ') || 'none recorded'}`,
    '', 'TIMELINE'
  ];
  for (const event of report.timeline) {
    lines.push(`${event.ts} | ${event.type || 'event'} | ${event.botId || event.campaignId || '—'} | ${event.reason || ''}`);
  }
  lines.push('', 'LIMITATIONS', ...report.limitations.map(s => `- ${s}`));
  return lines.join('\n') + '\n';
}

export function validateReview(body) {
  const botId = String(body?.botId || '').trim().toUpperCase();
  const status = String(body?.status || '').trim();
  const note = body?.note == null ? '' : body.note;
  if (!BOT_ID.test(botId)) throw new RangeError('invalid_bot_id');
  if (!REVIEW_STATUSES.has(status)) throw new RangeError('invalid_review_status');
  if (typeof note !== 'string' || note.length > 500 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(note)) {
    throw new RangeError('invalid_review_note');
  }
  return { botId, status, note:note.trim() };
}
