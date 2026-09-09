import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAnchorWeight } from '../src/anchorweight.js';
import { MemoryStore } from '../src/store.js';
import { PersistentStore } from '../src/persistent-store.js';
import { createReverseProxy } from '../src/proxy.js';
import { nextToken } from '../src/procedural.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('whole-site proxy passes humans to origin, then silently isolates a convicted crawler', async t => {
  let originHits = 0;
  const origin = http.createServer((req, res) => {
    originHits++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>REAL ORIGIN</h1><p>${req.url}</p>`);
  });
  const originPort = await listen(origin);
  t.after(() => origin.close());

  const config = {
    secret: 'integration-secret', basePath: '/anchor', shadowMode: false,
    blockDepth: 3, blockMinutes: 60, repeatBlockMinutes: 1440,
    sessionTtlMinutes: 30, sessionBindIp: true, trustProxy: false,
    dashboardEnabled: false, dashboardToken: '', logFile: path.join(os.tmpdir(), 'aw-int-events.jsonl'),
    branchCount: 7, quarantineMode: 'decoy', originUrl: `http://127.0.0.1:${originPort}`,
    proxyTimeoutMs: 5000, publicScheme: 'https'
  };
  const store = new MemoryStore();
  const aw = createAnchorWeight(config, { store, log: () => {} });
  const proxy = createReverseProxy(config);
  const gateway = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://test');
    if (await aw.preflight(req, res, url)) return;
    if (url.pathname === '/anchor' || url.pathname.startsWith('/anchor/')) return aw.handle(req, res, url);
    proxy(req, res);
  });
  const gatewayPort = await listen(gateway);
  t.after(() => gateway.close());

  const real = await request(gatewayPort, '/products');
  assert.equal(real.status, 200);
  assert.match(real.body, /REAL ORIGIN/);
  assert.equal(originHits, 1);

  await request(gatewayPort, '/anchor/');
  const [sid] = store.sessions.keys();
  const t1 = nextToken(config.secret, sid, 1, '');
  const t2 = nextToken(config.secret, sid, 2, t1);
  const t3 = nextToken(config.secret, sid, 3, t2);
  await request(gatewayPort, `/anchor/t/${sid}/${t1}`);
  await request(gatewayPort, `/anchor/t/${sid}/${t1}/${t2}`);
  await request(gatewayPort, `/anchor/t/${sid}/${t1}/${t2}/${t3}`);
  assert.equal(store.snapshot().activeBlocks, 1);

  const decoy = await request(gatewayPort, '/products');
  assert.equal(decoy.status, 200);
  assert.doesNotMatch(decoy.body, /REAL ORIGIN/);
  assert.equal(decoy.body.includes('<a '), false);
  assert.equal(originHits, 1, 'quarantined request must never reach the real origin');

  const apiDecoy = await request(gatewayPort, '/api/catalog', { accept: 'application/json' });
  assert.equal(apiDecoy.status, 200);
  assert.equal(apiDecoy.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(apiDecoy.body).results, []);
  assert.equal(originHits, 1);
});

test('persistent store restores active quarantines and offense counts after restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchorweight-state-'));
  const file = path.join(dir, 'state.json');
  const store1 = new PersistentStore(file);
  store1.noteOffense('client-key');
  store1.block('client-key', 60, 'proof_of_crawl');

  const store2 = new PersistentStore(file);
  assert.ok(store2.isBlocked('client-key'));
  assert.equal(store2.offenses.get('client-key'), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
