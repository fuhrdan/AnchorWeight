import crypto from 'node:crypto';

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

const titles = ['Archive', 'Documents', 'Resource Center', 'Media Library', 'Site Index', 'Knowledge Base', 'Reference', 'Records', 'Information'];
const paragraphs = [
  'This resource is currently available in read-only mode.',
  'The requested material is available in the current site archive.',
  'Content indexing is complete. Additional navigation is not available from this page.',
  'This page contains an archived snapshot of a previously published resource.',
  'The requested resource is available for reference.'
];

function pick(secret, ipKey, pathname, items, slot) {
  const h = crypto.createHmac('sha256', secret).update(`decoy:${ipKey}:${pathname}:${slot}`).digest();
  return items[h[0] % items.length];
}

export function renderDecoy(config, ipKey, url, req) {
  const title = pick(config.secret, ipKey, url.pathname, titles, 'title');
  const paragraph = pick(config.secret, ipKey, url.pathname, paragraphs, 'paragraph');
  const accepts = String(req?.headers?.accept || '');
  const wantsJson = url.pathname.startsWith('/api/') || accepts.includes('application/json');

  if (wantsJson) {
    return {
      type: 'application/json; charset=utf-8',
      body: JSON.stringify({ status: 'ok', resource: url.pathname, state: 'archived', results: [] })
    };
  }

  const displayPath = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  return {
    type: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(title)}</title></head><body><main><h1>${esc(title)}</h1><p>${esc(paragraph)}</p><p><small>${esc(displayPath)}</small></p></main></body></html>`
  };
}
