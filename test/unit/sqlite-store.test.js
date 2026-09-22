import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../src/create-store.js';
import { newProfile } from '../../src/behavior.js';

const supported = Number(process.versions.node.split('.')[0]) >= 22;
const config = (dir) => ({ stateBackend: 'sqlite', sqliteFile: path.join(dir,'state.sqlite'), stateFile: path.join(dir,'state.json') });

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sqlite-'));
  try { await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('JSON remains the default and supports Node 20', async () => fixture(async dir => {
  const store=await createStore({stateBackend:'json',stateFile:path.join(dir,'state.json')});
  assert.equal(store.constructor.name,'PersistentStore');
  store.noteOffense('key');
  const reopened=await createStore({stateBackend:'json',stateFile:path.join(dir,'state.json')});
  assert.equal(reopened.offenses.get('key'),1);
}));

test('SQLite imports v4 JSON, preserves original, persists changed rows and policies', {skip:!supported}, async () => fixture(async dir => {
  const c=config(dir);
  fs.writeFileSync(c.stateFile,JSON.stringify({version:4, blocks:[], offenses:[['client',3]], profiles:[['abcdef123456',{...newProfile(), score:4, manualPolicy:'allow'}]],campaigns:[]}));
  const original=fs.readFileSync(c.stateFile,'utf8');
  const store=await createStore(c);
  assert.equal(store.backend,'sqlite');
  assert.equal(store.loadedStateVersion,5);
  assert.ok(store.migrationsApplied.includes('JSON->SQLite'));
  assert.equal(store.getPublicProfileById('AW-ABCDEF12').manualPolicy,'allow');
  assert.equal(store.noteOffense('client'),4);
  store.block('client',60,'test');
  const profile=store.getProfile('abcdef123456');profile.score=101;store.touchProfile('abcdef123456');
  const campaign=store.getCampaign('AWC-X');campaign.confidence=90;store.touchCampaign('AWC-X');
  store.close();
  assert.equal(fs.readFileSync(c.stateFile,'utf8'),original);
  const reopened=await createStore(c);
  assert.equal(reopened.offenses.get('client'),4);
  assert.equal(reopened.blocks.get('client').reason,'test');
  assert.equal(reopened.getProfile('abcdef123456').score,101);
  assert.equal(reopened.campaigns.get('AWC-X').confidence,90);
  assert.equal(reopened.migrationsApplied.length,0);
  reopened.close();
}));

test('SQLite refuses corrupted JSON without importing it', {skip:!supported}, async () => fixture(async dir => {
  const c=config(dir);fs.writeFileSync(c.stateFile,'corrupt');
  await assert.rejects(createStore(c),/Unable to import legacy JSON state/);
  assert.equal(fs.readFileSync(c.stateFile,'utf8'),'corrupt');
}));

test('SQLite does not overwrite existing incompatible database', {skip:!supported}, async () => fixture(async dir => {
  const c=config(dir);
  const store=await createStore(c);
  store.noteOffense('persist');
  store.db.prepare("UPDATE metadata SET value='999' WHERE key='state_version'").run();
  store.close();
  await assert.rejects(createStore(c),/not supported/);
}));

test('SQLite removes expired blocks from disk', {skip:!supported}, async () => fixture(async dir => {
  const c=config(dir);const store=await createStore(c);
  store.block('expired',1,'temporary');
  store.blocks.get('expired').until=0;store.touchProfile('unrelated');
  store.cleanup();store.close();
  const reopened=await createStore(c);
  assert.equal(reopened.blocks.has('expired'),false);
  reopened.close();
}));
