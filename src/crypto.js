import crypto from 'node:crypto';

export function shortHmac(secret, value, length = 16) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url').slice(0, length);
}

export function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function ipFingerprint(secret, ip) {
  return shortHmac(secret, `ip:${ip}`, 20);
}
