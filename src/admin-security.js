import crypto from 'node:crypto';

export class AdminSecurity {
  constructor(config, now = () => Date.now()) {
    this.config = config;
    this.now = now;
    this.csrf = new Map();
    this.rate = new Map();
  }

  authenticate(req, url, safeEqual) {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const queryToken = this.config.allowQueryAdminToken ? (url.searchParams.get('token') || '') : '';
    const token = bearer || queryToken;
    return !!this.config.dashboardToken && !!token && safeEqual(token, this.config.dashboardToken);
  }

  clientKey(req) {
    let raw=String(req.socket?.remoteAddress || 'unknown');
    if (this.config.trustProxy) {
      const forwarded=req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string' && forwarded) raw=forwarded.split(',')[0].trim();
    }
    return crypto.createHmac('sha256', this.config.secret).update(raw).digest('hex').slice(0, 12);
  }

  rateLimit(req, bucket = 'admin') {
    const key = `${bucket}:${this.clientKey(req)}`;
    const now = this.now();
    const windowMs = 60_000;
    let r = this.rate.get(key);
    if (!r || now - r.startedAt >= windowMs) r = { startedAt: now, count: 0 };
    r.count++;
    this.rate.set(key, r);
    const limit = this.config.adminRateLimitPerMinute || 60;
    return { allowed: r.count <= limit, remaining: Math.max(0, limit - r.count), resetMs: Math.max(0, windowMs - (now-r.startedAt)) };
  }

  issueCsrf(req) {
    this.cleanup();
    const token = crypto.randomBytes(24).toString('base64url');
    this.csrf.set(token, {
      clientKey: this.clientKey(req),
      expiresAt: this.now() + (this.config.csrfTtlMinutes || 15) * 60_000
    });
    return token;
  }

  validateCsrf(req) {
    this.cleanup();
    const token = String(req.headers['x-aw-csrf'] || '');
    const entry = this.csrf.get(token);
    if (!entry || entry.clientKey !== this.clientKey(req)) return false;
    return true;
  }

  cleanup() {
    const now=this.now();
    for (const [k,v] of this.csrf) if (v.expiresAt <= now) this.csrf.delete(k);
    for (const [k,v] of this.rate) if (now-v.startedAt > 120_000) this.rate.delete(k);
  }
}
