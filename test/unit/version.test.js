import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';

test('rc.1 exposes one runtime version owner',()=>{
  assert.equal(ANCHORWEIGHT_VERSION,'3.0.0-rc.2');
  assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'rc');
});
