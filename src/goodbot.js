import dns from 'node:dns/promises';
import net from 'node:net';

const PROVIDERS = [
  { id: 'google', ua: /googlebot|google-inspectiontool|googleother/i, suffixes: ['.googlebot.com', '.google.com'] },
  { id: 'bing', ua: /bingbot|adidxbot/i, suffixes: ['.search.msn.com'] }
];

function normalizeIp(ip) {
  const s = String(ip || '').trim().toLowerCase();
  return s.startsWith('::ffff:') ? s.slice(7) : s;
}

function validHostname(host, suffixes) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  return suffixes.some(s => h.endsWith(s) && h.length > s.length);
}

export function claimedProvider(userAgent = '') {
  return PROVIDERS.find(p => p.ua.test(userAgent)) || null;
}

export class GoodBotVerifier {
  constructor(config, opts = {}) {
    this.config = config;
    this.reverse = opts.reverse || dns.reverse;
    this.lookup = opts.lookup || dns.lookup;
    this.now = opts.now || (() => Date.now());
    this.cache = new Map();
  }

  async verify(ip, userAgent) {
    if (!this.config.goodBotVerificationEnabled) return { claimed: false, verified: false, provider: null };
    const provider = claimedProvider(userAgent);
    if (!provider) return { claimed: false, verified: false, provider: null };
    const normalized = normalizeIp(ip);
    if (!net.isIP(normalized)) return { claimed: true, verified: false, provider: provider.id, reason: 'invalid_ip' };

    const key = `${provider.id}:${normalized}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    let value;
    try {
      const hosts = await this.reverse(normalized);
      const host = hosts.find(h => validHostname(h, provider.suffixes));
      if (!host) value = { claimed: true, verified: false, provider: provider.id, reason: 'reverse_mismatch' };
      else {
        const forwards = await this.lookup(host, { all: true, verbatim: true });
        const matched = forwards.some(x => normalizeIp(x.address) === normalized);
        value = matched
          ? { claimed: true, verified: true, provider: provider.id, hostname: host }
          : { claimed: true, verified: false, provider: provider.id, reason: 'forward_mismatch' };
      }
    } catch {
      value = { claimed: true, verified: false, provider: provider.id, reason: 'dns_error' };
    }
    this.cache.set(key, { expiresAt: this.now() + this.config.goodBotCacheMinutes * 60_000, value });
    return value;
  }
}

export function normalizeClientIp(ip) { return normalizeIp(ip); }
