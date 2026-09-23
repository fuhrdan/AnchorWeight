import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from './store.js';
import { migrateState, CURRENT_STATE_VERSION } from './migrations.js';

export class PersistentStore extends MemoryStore {
  constructor(file, now = () => Date.now()) {
    super(now);
    this.file = file;
    this.backend = 'json';
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const migrated = migrateState(raw);
      const parsed = migrated.state;
      this.loadedStateVersion = migrated.toVersion;
      this.migrationsApplied = migrated.applied;
      for (const [k, v] of parsed.blocks || []) this.blocks.set(k, v);
      for (const [k, v] of parsed.offenses || []) this.offenses.set(k, v);
      for (const [k, v] of parsed.profiles || []) this.profiles.set(k, v);
      for (const [k, v] of parsed.campaigns || []) this.campaigns.set(k, v);
      this.cleanup();
      if (migrated.applied.length) this.persist();
    } catch (err) {
      if (err?.code === 'ENOENT') {
        this.loadedStateVersion = CURRENT_STATE_VERSION;
        this.migrationsApplied = [];
        return;
      }
      throw new Error(`Unable to load AnchorWeight state: ${err.message}`);
    }
  }

  persist() {
    try {
      const dir = path.dirname(this.file);
      fs.mkdirSync(dir, { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ version: CURRENT_STATE_VERSION, meta: { appVersion:'1.6.0', writtenAt:new Date().toISOString() }, blocks: [...this.blocks], offenses: [...this.offenses], profiles: [...this.profiles], campaigns: [...this.campaigns] }));
      fs.renameSync(temp, this.file);
    } catch (err) {
      console.error('[AnchorWeight] Unable to persist state:', err.message);
    }
  }

  noteOffense(ipKey) { const count = super.noteOffense(ipKey); this.persist(); return count; }
  block(ipKey, minutes, reason) { const until = super.block(ipKey, minutes, reason); this.persist(); return until; }
  touchProfile(_ipKey) { this.persist(); }
  touchCampaign(_id) { this.persist(); }

  flush() { this.persist(); }

  cleanup() {
    const before = this.blocks.size;
    super.cleanup();
    if (this.file && this.blocks.size !== before) this.persist();
  }
}
