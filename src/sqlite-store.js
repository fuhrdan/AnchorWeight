/**
 * Optional, single-process SQLite persistence for AnchorWeight.
 *
 * Import node:sqlite only when this backend is selected. JSON deployments and
 * Node 20 installations can continue to run without importing the module.
 *
 * In-memory maps remain the request-time index; only the changed database row
 * is written by each mutation hook. These maps are NOT synchronized between
 * processes: do not use one database file for multiple running workers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from './store.js';
import { migrateState, CURRENT_STATE_VERSION } from './migrations.js';

const KINDS = ['blocks', 'offenses', 'profiles', 'campaigns'];

export class SqliteStore extends MemoryStore {
  constructor(file, DatabaseSync, options = {}) {
    super(options.now ?? (() => Date.now()));
    if (typeof DatabaseSync !== 'function') throw new Error('SQLite backend requires Node.js 22.13+ with node:sqlite available');
    this.file = path.resolve(file);
    this.backend = 'sqlite';
    this.loadedStateVersion = CURRENT_STATE_VERSION;
    this.migrationsApplied = [];
    const existed = fs.existsSync(this.file);
    let legacy = null;
    if (!existed && options.legacyFile && fs.existsSync(options.legacyFile)) {
      try { legacy = migrateState(JSON.parse(fs.readFileSync(options.legacyFile, 'utf8'))); }
      catch (err) { throw new Error(`Unable to import legacy JSON state: ${err.message}`); }
    }
    if (existed && fs.statSync(this.file).size === 0) throw new Error('Refusing to open an empty SQLite state file');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file, { timeout: 5000 });
    if (!existed) fs.chmodSync(this.file, 0o600);
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      this.db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS entries (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (kind, key));');
      this.write = this.db.prepare('INSERT INTO entries (kind,key,value) VALUES (?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value');
      this.remove = this.db.prepare('DELETE FROM entries WHERE kind=? AND key=?');
      const row = this.db.prepare("SELECT value FROM metadata WHERE key='state_version'").get();
      if (!row) {
        const existingEntries = this.db.prepare('SELECT count(*) AS n FROM entries').get().n;
        if (existed || existingEntries) throw new Error('SQLite state file has no recognized AnchorWeight version; refusing to overwrite it');
        this.initialize(legacy);
      } else {
        const version = Number(row.value);
        if (version !== CURRENT_STATE_VERSION) throw new Error(`SQLite state version ${version} is not supported by this release (expected ${CURRENT_STATE_VERSION})`);
      }
      for (const entry of this.db.prepare('SELECT kind,key,value FROM entries').all()) {
        if (!KINDS.includes(entry.kind)) throw new Error(`Unexpected state entry kind: ${entry.kind}`);
        this[entry.kind].set(entry.key, JSON.parse(entry.value));
      }
      this.cleanup();
    } catch (err) {
      this.db.close();
      throw new Error(`Unable to load AnchorWeight SQLite state: ${err.message}`);
    }
  }

  initialize(migrated) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (migrated) {
        for (const kind of KINDS) for (const [key, value] of migrated.state[kind]) {
          this.write.run(kind, key, JSON.stringify(value));
        }
        this.migrationsApplied = [...migrated.applied, 'JSON->SQLite'];
      }
      this.db.prepare("INSERT INTO metadata (key,value) VALUES ('state_version',?)").run(String(CURRENT_STATE_VERSION));
      this.db.prepare("INSERT INTO metadata (key,value) VALUES ('app_version','1.7.0')").run();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    // The original JSON file is intentionally retained as an offline rollback.
  }

  touchProfile(key) { this.persistEntry('profiles', key); }
  touchCampaign(id) { this.persistEntry('campaigns', id); }

  persistEntry(kind, key) {
    const value = this[kind].get(key);
    if (value === undefined) this.remove.run(kind, key);
    else this.write.run(kind, key, JSON.stringify(value));
  }

  noteOffense(key) {
    const count = super.noteOffense(key);
    this.persistEntry('offenses', key);
    return count;
  }

  block(key, minutes, reason) {
    const until = super.block(key, minutes, reason);
    this.persistEntry('blocks', key);
    return until;
  }

  cleanup() {
    const expired = [];
    const now = this.now();
    for (const [key, block] of this.blocks) if (block.until <= now) expired.push(key);
    super.cleanup();
    if (this.remove) for (const key of expired) this.remove.run('blocks', key);
  }

  flush() { this.db.exec('PRAGMA wal_checkpoint(PASSIVE)'); }
  close() { this.flush(); this.db.close(); }
}
