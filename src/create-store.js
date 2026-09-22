/** Select a persistence backend without changing the default JSON deployment. */
import { PersistentStore } from './persistent-store.js';

export async function createStore(config) {
  if (config.stateBackend === 'json') return new PersistentStore(config.stateFile);
  if (config.stateBackend !== 'sqlite') throw new Error(`Unknown state backend: ${config.stateBackend}`);
  const [sqlite, { SqliteStore }] = await Promise.all([
    import('node:sqlite').catch(err => { throw new Error(`SQLite requires Node.js 22.13+ with node:sqlite: ${err.message}`); }),
    import('./sqlite-store.js')
  ]);
  return new SqliteStore(config.sqliteFile, sqlite.DatabaseSync, { legacyFile: config.stateFile });
}
