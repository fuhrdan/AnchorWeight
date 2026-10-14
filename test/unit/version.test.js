import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';

test('v3.1.0-alpha.5 exposes one runtime version owner and alpha channel',()=>{
  assert.equal(ANCHORWEIGHT_VERSION,'3.1.0-alpha.5');
  assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'alpha');
});
