import fs from 'node:fs';
import path from 'node:path';
import { ANCHORWEIGHT_VERSION } from './version.js';

export function createAuditLogger(file) {
  return function audit(event) {
    const record = {
      ts: new Date().toISOString(),
      version: ANCHORWEIGHT_VERSION,
      ...event
    };
    try {
      fs.mkdirSync(path.dirname(file), {recursive:true});
      fs.appendFileSync(file, JSON.stringify(record) + '\n', {encoding:'utf8', mode:0o600});
    } catch (err) {
      console.error('[AnchorWeight] audit write failed:', err.message);
    }
  };
}
