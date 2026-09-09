import { shortHmac } from './crypto.js';

const nouns = ['archive', 'backup', 'assets', 'exports', 'media', 'legacy', 'cache', 'reports', 'storage', 'snapshots', 'records', 'images'];
const suffixes = ['old', '2024', '2025', 'final', 'copy', 'v2', 'data', 'private', 'static'];

export function nextToken(secret, sessionId, depth, parentToken = '') {
  return shortHmac(secret, `path:${sessionId}:${depth}:${parentToken}`, 18);
}

export function validateChain(secret, sessionId, tokens) {
  let parent = '';
  for (let i = 0; i < tokens.length; i++) {
    const expected = nextToken(secret, sessionId, i + 1, parent);
    if (tokens[i] !== expected) return false;
    parent = tokens[i];
  }
  return true;
}

export function childEntries(secret, sessionId, tokens, count = 7) {
  const depth = tokens.length + 1;
  const parent = tokens.at(-1) || '';
  const required = nextToken(secret, sessionId, depth, parent);
  const seed = shortHmac(secret, `children:${sessionId}:${parent}`, 32);
  const entries = [];

  for (let i = 0; i < count; i++) {
    const a = parseInt(seed.slice((i * 2) % 24, ((i * 2) % 24) + 2), 16);
    const b = parseInt(seed.slice(((i * 2) + 7) % 24, (((i * 2) + 7) % 24) + 2), 16);
    const name = `${nouns[a % nouns.length]}-${suffixes[b % suffixes.length]}-${String((a * 97 + b * 31) % 10000).padStart(4, '0')}`;
    entries.push({ name, token: required, decoy: i !== 0 });
  }
  return entries;
}
