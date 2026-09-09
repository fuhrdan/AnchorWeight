import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateState, CURRENT_STATE_VERSION } from '../../src/migrations.js';

test('state v2 migrates sequentially to current schema',()=>{
  const r=migrateState({version:2,blocks:[],offenses:[],profiles:[]});
  assert.equal(r.toVersion,CURRENT_STATE_VERSION); assert.equal(r.state.version,CURRENT_STATE_VERSION); assert.ok(r.applied.length>=1); assert.deepEqual(r.state.campaigns,[]);
});

test('future state versions fail instead of being silently accepted',()=>{
  assert.throws(()=>migrateState({version:999}),/newer than/);
});

test('invalid state shape fails migration',()=>{
  assert.throws(()=>migrateState([]),/JSON object/);
});
