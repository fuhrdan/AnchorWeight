import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuditLogger } from '../../src/audit.js';
import { readEvents } from '../../src/logger.js';

test('audit logger produces structured v1 records',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-audit-')); const file=path.join(dir,'audit.jsonl');
  createAuditLogger(file)({type:'operator_test',client:'abc'});
  const r=JSON.parse(fs.readFileSync(file,'utf8').trim());
  assert.equal(r.version,'1.4.0'); assert.equal(r.type,'operator_test'); assert.ok(r.ts);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('event reader ignores malformed lines and redacts internal key',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aw-events-')); const file=path.join(dir,'events.jsonl');
  fs.writeFileSync(file,'bad json\n'+JSON.stringify({ts:new Date().toISOString(),type:'lure',ipKey:'abcdef123456'})+'\n');
  const e=readEvents(file,{limit:10}); assert.equal(e.length,1); assert.equal(e[0].botId,'AW-ABCDEF12'); assert.equal('ipKey' in e[0],false);
  fs.rmSync(dir,{recursive:true,force:true});
});
