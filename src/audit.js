import fs from 'node:fs';
import path from 'node:path';

export function createAuditLogger(file) {
  return function audit(event) {
    const record = {
      ts: new Date().toISOString(),
      version: '2.5.0',
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
