import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRobotsDisallow,
  hiddenBlackholeLink,
  injectHiddenBlackholeLink,
  shouldRewriteOriginResponse,
  rewriteOriginResponse
} from '../../src/blackhole.js';

test('robots.txt receives one AnchorWeight disallow rule', () => {
  const first = appendRobotsDisallow('User-agent: *\nAllow: /\n', '/anchor/blackhole');
  assert.match(first, /Disallow: \/anchor\/blackhole/);
  const second = appendRobotsDisallow(first, '/anchor/blackhole');
  assert.equal(second, first);
});

test('hidden blackhole link is invisible to normal browser layout', () => {
  const link = hiddenBlackholeLink('/anchor/blackhole');
  assert.match(link, /hidden/);
  assert.match(link, /aria-hidden="true"/);
  assert.match(link, /href="\/anchor\/blackhole"/);
});

test('HTML injection occurs before closing body and is idempotent', () => {
  const html = '<html><body><p>Hello</p></body></html>';
  const first = injectHiddenBlackholeLink(html, '/anchor/blackhole');
  assert.match(first, /<a[^>]+\/anchor\/blackhole/);
  assert.ok(first.indexOf('/anchor/blackhole') < first.indexOf('</body>'));
  assert.equal(injectHiddenBlackholeLink(first, '/anchor/blackhole'), first);
});

test('proxy rewrite is limited to successful UTF-8 robots or HTML responses', () => {
  const config = { blackholeEnabled: true, blackholeInjectLink: true, blackholePath: '/anchor/blackhole', basePath: '/anchor' };
  assert.equal(shouldRewriteOriginResponse({ pathname:'/robots.txt', method:'GET', statusCode:200, contentType:'text/plain; charset=utf-8', contentEncoding:'', config }), true);
  assert.equal(shouldRewriteOriginResponse({ pathname:'/page', method:'GET', statusCode:200, contentType:'text/html; charset=UTF-8', contentEncoding:'', config }), true);
  assert.equal(shouldRewriteOriginResponse({ pathname:'/page', method:'GET', statusCode:200, contentType:'text/html', contentEncoding:'gzip', config }), false);
  assert.equal(shouldRewriteOriginResponse({ pathname:'/page', method:'POST', statusCode:200, contentType:'text/html', contentEncoding:'', config }), false);
  assert.equal(shouldRewriteOriginResponse({
      pathname:'/robots.txt',
      method:'GET',
      statusCode:304,
      contentType:'text/plain',
      contentEncoding:'',
      config
    }), false);

    assert.equal(shouldRewriteOriginResponse({
      pathname:'/robots.txt',
      method:'GET',
      statusCode:302,
      contentType:'text/plain',
      contentEncoding:'',
      config
    }), false);
});

test('rewrite helper changes robots and HTML bodies only as intended', () => {
  const config = { blackholePath:'/anchor/blackhole' };
  assert.match(rewriteOriginResponse('User-agent: *\n', { pathname:'/robots.txt', contentType:'text/plain', config }), /Disallow: \/anchor\/blackhole/);
  assert.match(rewriteOriginResponse('<html><body>x</body></html>', { pathname:'/', contentType:'text/html', config }), /\/anchor\/blackhole/);
});
