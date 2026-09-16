function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function robotsDisallowLine(path) {
  return `Disallow: ${path}`;
}

export function appendRobotsDisallow(body, path) {
  const text = String(body ?? '');
  const line = robotsDisallowLine(path);
  if (text.split(/\r?\n/).some(existing => existing.trim() === line)) return text;

  const prefix = text && !text.endsWith('\n') ? `${text}\n` : text;
  return `${prefix}${prefix ? '\n' : ''}# AnchorWeight robots blackhole\nUser-agent: *\n${line}\n`;
}

export function hiddenBlackholeLink(path) {
  const href = escapeAttr(path);
  return `<a href="${href}" rel="nofollow" aria-hidden="true" tabindex="-1" hidden>archive index</a>`;
}

export function injectHiddenBlackholeLink(html, path) {
  const text = String(html ?? '');
  if (text.includes(`href="${path}"`) || text.includes(`href='${path}'`)) return text;

  const link = hiddenBlackholeLink(path);
  if (/<\/body\s*>/i.test(text)) return text.replace(/<\/body\s*>/i, `${link}</body>`);
  return `${text}${link}`;
}

function isUtf8Like(contentType) {
  const match = String(contentType || '').match(/charset\s*=\s*['"]?([^;\s'"]+)/i);
  if (!match) return true;
  const charset = match[1].toLowerCase();
  return charset === 'utf-8' || charset === 'utf8';
}

export function shouldRewriteOriginResponse({ pathname, method, statusCode, contentType, contentEncoding, config }) {
  if (!config?.blackholeEnabled || method !== 'GET') return false;
  if (contentEncoding && String(contentEncoding).toLowerCase() !== 'identity') return false;
  if (!isUtf8Like(contentType)) return false;

  if (pathname === '/robots.txt') {
    return statusCode === 200;
  }

  return !!config.blackholeInjectLink &&
    statusCode >= 200 && statusCode < 300 &&
    String(contentType || '').toLowerCase().includes('text/html') &&
    !pathname.startsWith(`${config.basePath}/`);
}

export function rewriteOriginResponse(body, { pathname, contentType, config }) {
  if (pathname === '/robots.txt') return appendRobotsDisallow(body, config.blackholePath);
  if (String(contentType || '').toLowerCase().includes('text/html')) {
    return injectHiddenBlackholeLink(body, config.blackholePath);
  }
  return String(body ?? '');
}
