import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../src/create-store.js';
import { backupFiles, restoreFiles, exportEvidence, inspectConfiguredState } from '../../src/ops.js';

const supported = Number(process.versions.node.split('.')[0]) >= 22;

test('SQLite backup is consistent with live WAL and restorable while stopped', {skip:!supported},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-sqlite-ops-'));
  const config={stateBackend:'sqlite',stateFile:path.join(dir,'legacy.json'),sqliteFile:path.join(dir,'live.sqlite'),logFile:path.join(dir,'events.jsonl'),auditLogFile:path.join(dir,'audit.jsonl')};
  let store;
  try {
    store=await createStore(config);
    store.noteOffense('A');
    store.block('A',60,'test');
    const report=await exportEvidence(config,path.join(dir,'report.json'));
    assert.equal(report.summary.blocks,1);
    const inspection=await inspectConfiguredState(config);
    assert.equal(inspection.backend,'sqlite');
    assert.equal(inspection.counts.offenses,1);
    const backup=await backupFiles(config,path.join(dir,'backup'));
    assert.ok(backup.manifest.copied.some(x=>x.label==='sqlite-state'));
    store.noteOffense('A');
    store.close();store=null;
    restoreFiles(config,backup.dir);
    const reopened=await createStore(config);
    assert.equal(reopened.offenses.get('A'),1);
    assert.equal(reopened.blocks.get('A').reason,'test');
    reopened.close();
  } finally {
    store?.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
