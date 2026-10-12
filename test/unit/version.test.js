import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';

test('beta.7 exposes one runtime version owner',()=>{
  assert.equal(ANCHORWEIGHT_VERSION,'3.0.0-beta.7');
  assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'beta');
});
