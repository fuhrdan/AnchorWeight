/**
 * Application authentication is separate from dashboard authentication and Bot DNA.
 * Only operator-authored, private JSON rules can protect proxied routes. Neither
 * URL headers nor a client-provided hostname can select a rule or an upstream.
 *
 * This module stores password verifiers and API-key digests, never plaintext
 * credentials. The file is read once at startup; change it while stopped and
 * restart AnchorWeight. Failed reads must prevent an enabled gateway starting.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_AUTH_BYTES = 32768;
export const MAX_AUTH_POLICIES = 16;
const MAX_CREDENTIALS = 8;
const RESERVED = ['/live', '/health', '/ready', '/dashboard.html', '/setup.html'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const HEX32 = /^[a-f0-9]{32}$/;
const PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;
const KEY = /^aw_[A-Za-z0-9_-]{43}$/;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactly = (value, fields) => isObject(value) &&
  Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const matches = (prefix, value) => prefix === '/' || value === prefix || value.startsWith(`${prefix}/`);

export function validateAuthPath(value, basePath = '/anchor') {
  if (typeof value !== 'string' || value.length > 128 || !PATH.test(value) || value.includes('//'))
    throw Error('invalid_auth_path');
  if (value !== '/' && [...RESERVED, basePath].some(p => matches(value, p) || matches(p, value)))
    throw Error('protected_anchorweight_path');
  return value;
}

export function validateAuthDocument(doc, config = {}) {
  if (!exactly(doc, ['version', 'policies']) || doc.version !== 1 ||
      !Array.isArray(doc.policies) || doc.policies.length > MAX_AUTH_POLICIES)
    throw Error('invalid_auth_document');
  const seenPaths = new Set();
  const policies = doc.policies.map(rule => {
    if (!exactly(rule, ['path', 'mode', 'credentials']) ||
        !['basic', 'api_key'].includes(rule.mode) || !Array.isArray(rule.credentials) ||
        rule.credentials.length < 1 || rule.credentials.length > MAX_CREDENTIALS)
      throw Error('invalid_auth_policy');
    const target = validateAuthPath(rule.path, config.basePath || '/anchor');
    if (seenPaths.has(target)) throw Error('duplicate_auth_path');
    seenPaths.add(target);
    const ids = new Set();
    const credentials = rule.credentials.map(credential => {
      const fields = rule.mode === 'basic' ? ['id', 'salt', 'hash'] : ['id', 'hash'];
      if (!exactly(credential, fields) || !ID.test(credential.id) ||
          !HEX64.test(credential.hash) ||
          (rule.mode === 'basic' && !HEX32.test(credential.salt)))
        throw Error('invalid_auth_credential');
      if (ids.has(credential.id)) throw Error('duplicate_auth_credential');
      ids.add(credential.id);
      return Object.freeze({ ...credential });
    });
    return Object.freeze({ path: target, mode: rule.mode, credentials: Object.freeze(credentials) });
  });
  return Object.freeze(policies.sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path)));
}

export function readAuthPolicies(config, file = config.appAuthFile) {
  if (!config.appAuthEnabled) return Object.freeze([]);
  const resolved = path.resolve(file || './data/anchorweight-app-auth.json');
  const dataRoot = path.resolve('./data');
  if (!resolved.startsWith(`${dataRoot}${path.sep}`) || !resolved.endsWith('.json'))
    throw Error('auth_file_must_be_private_json_in_data');
  // Open first, then inspect the SAME descriptor. Reject symlinks on supported OSes.
  const fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_AUTH_BYTES) throw Error('invalid_auth_file');
    // On shared Linux hosting a credentials policy must not be readable by other accounts.
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      throw Error('auth_file_permissions_require_0600');
    const bytes = Buffer.alloc(Math.min(MAX_AUTH_BYTES + 1, stat.size + 1));
    const n = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (n > MAX_AUTH_BYTES || n !== stat.size) throw Error('invalid_auth_file');
    return validateAuthDocument(JSON.parse(bytes.subarray(0, n).toString('utf8')), config);
  } finally { fs.closeSync(fd); }
}

/** Derive a verifier offline. Never store the password or include it in logs. */
export function makeBasicCredential(id, password) {
  if (!ID.test(id) || typeof password !== 'string' || password.length < 12 ||
      Buffer.byteLength(password) > 256 || /[\x00-\x1f\x7f]/.test(password))
    throw Error('invalid_basic_credential');
  const salt = crypto.randomBytes(16).toString('hex');
  return { id, salt, hash: crypto.scryptSync(password, Buffer.from(salt, 'hex'), 32, SCRYPT).toString('hex') };
}

/** Return the key only once to the operator; store only SHA-256 of its random 256-bit value. */
export function makeApiCredential(id) {
  if (!ID.test(id)) throw Error('invalid_key_id');
  const key = `aw_${crypto.randomBytes(32).toString('base64url')}`;
  return { key, credential: { id, hash: crypto.createHash('sha256').update(key).digest('hex') } };
}

function constantEqual(expectedHex, actual) {
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function readBasic(header) {
  if (typeof header !== 'string' || header.length > 1024 || !header.startsWith('Basic ')) return null;
  const encoded = header.slice(6);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  const plain = Buffer.from(encoded, 'base64');
  if (plain.toString('base64') !== encoded || plain.length > 384) return null;
  const index = plain.indexOf(58);
  if (index < 1) return null;
  const username = plain.subarray(0, index).toString('utf8');
  const password = plain.subarray(index + 1).toString('utf8');
  if (!ID.test(username) || Buffer.byteLength(password) > 256) return null;
  return { username, password };
}

/** In-flight cap prevents password hashing from exhausting the cPanel thread pool. */
export function createAppAuth(policies, { scrypt = crypto.scrypt, maxConcurrent = 4 } = {}) {
  let active = 0;
  const counters = { challenged: 0, authenticated: 0, busy: 0 };
  async function check(req, pathname) {
    const policy = policies.find(rule => matches(rule.path, pathname));
    if (!policy) return { action: 'pass' };
    if (policy.mode === 'api_key') {
      const key = req.headers['x-api-key'];
      const other = req.headers.authorization;
      if (typeof key !== 'string' || !KEY.test(key) || other != null) {
        counters.challenged++;
        return { action: 'challenge', mode: 'api_key' };
      }
      const digest = crypto.createHash('sha256').update(key).digest();
      const accepted = policy.credentials.some(item => constantEqual(item.hash, digest));
      if (!accepted) {
        counters.challenged++;
        return { action: 'challenge', mode: 'api_key' };
      }
    } else {
      const basic = readBasic(req.headers.authorization);
      if (!basic || req.headers['x-api-key'] != null) {
        counters.challenged++;
        return { action: 'challenge', mode: 'basic' };
      }
      const credential = policy.credentials.find(item => item.id === basic.username);
      if (!credential) {
        counters.challenged++;
        return { action: 'challenge', mode: 'basic' };
      }
      if (active >= maxConcurrent) {
        counters.busy++;
        return { action: 'busy' };
      }
      active++;
      let accepted = false;
      try {
        const hash = await new Promise((resolve, reject) =>
          scrypt(basic.password, Buffer.from(credential.salt, 'hex'), 32, SCRYPT,
            (error, value) => error ? reject(error) : resolve(value)));
        accepted = constantEqual(credential.hash, hash);
      } finally { active--; }
      if (!accepted) {
        counters.challenged++;
        return { action: 'challenge', mode: 'basic' };
      }
    }
    // NEVER forward authentication material to the approved upstream origin.
    delete req.headers.authorization;
    delete req.headers['x-api-key'];
    counters.authenticated++;
    return { action: 'pass' };
  }
  return { check, snapshot: () => ({
    enabled: policies.length > 0, policyCount: policies.length,
    basicPolicies: policies.filter(p => p.mode === 'basic').length,
    apiKeyPolicies: policies.filter(p => p.mode === 'api_key').length,
    ...counters
  }) };
}
