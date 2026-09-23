import { shortHmac } from './crypto.js';

const nouns = ['archive', 'backup', 'assets', 'exports', 'media', 'legacy', 'cache', 'reports', 'storage', 'snapshots', 'records', 'images'];
const suffixes = ['old', '2024', '2025', 'final', 'copy', 'v2', 'data', 'private', 'static'];

/** Branch zero retains v1.2's signed path format for upgrade compatibility. */
export function nextToken(secret, sessionId, depth, parentToken = '') {
  return shortHmac(secret, `path:${sessionId}:${depth}:${parentToken}`, 18);
}

/** Other branches are independently signed, not aliases of the same URL. */
export function branchToken(secret, sessionId, depth, parentToken = '', branch = 0) {
  if (!Number.isInteger(branch) || branch < 0 || branch >= 12) throw new RangeError('invalid canary branch');
  return branch === 0 ? nextToken(secret, sessionId, depth, parentToken)
    : shortHmac(secret, `branch:${sessionId}:${depth}:${parentToken}:${branch}`, 18);
}

/** Authenticate every hop; never use an unauthenticated session ID as campaign evidence. */
export function inspectChain(secret, sessionId, tokens, branchCount = 7, variants = true) {
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > 10) return null;
  if (!Number.isInteger(branchCount) || branchCount < 1 || branchCount > 12) return null;
  let parent = '';
  const branches = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{18}$/.test(token)) return null;
    let match = -1;
    const total = variants ? branchCount : 1;
    for (let branch = 0; branch < total; branch++) {
      if (token === branchToken(secret, sessionId, i + 1, parent, branch)) {
        match = branch;
        break;
      }
    }
    if (match === -1) return null;
    branches.push(match);
    parent = token;
  }
  return branches;
}

/** Legacy boolean API retained for plugins and existing tests. */
export function validateChain(secret, sessionId, tokens) {
  return inspectChain(secret, sessionId, tokens) !== null;
}

export function childEntries(secret, sessionId, tokens, count = 7, variants = true) {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new RangeError('invalid branch count');
  const depth = tokens.length + 1;
  const parent = tokens.at(-1) || '';
  const seed = shortHmac(secret, `children:${sessionId}:${parent}`, 32);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const a = parseInt(seed.slice((i * 2) % 24, ((i * 2) % 24) + 2), 16);
    const b = parseInt(seed.slice(((i * 2) + 7) % 24, (((i * 2) + 7) % 24) + 2), 16);
    const name = `${nouns[a % nouns.length]}-${suffixes[b % suffixes.length]}-${String((a * 97 + b * 31) % 10000).padStart(4, '0')}`;
    entries.push({ name, token: branchToken(secret, sessionId, depth, parent, variants ? i : 0), branch: variants ? i : 0, decoy: i !== 0 });
  }
  return entries;
}
