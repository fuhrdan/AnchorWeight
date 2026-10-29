import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORWEIGHT_VERSION, ANCHORWEIGHT_RELEASE_CHANNEL } from '../../src/version.js';
import { runFinalReleaseCheck } from '../../scripts/final-release-check.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('v3.2 alpha does not masquerade as the v3.0.0 stable release',()=>{assert.equal(ANCHORWEIGHT_VERSION,'3.2.0-alpha.3');assert.equal(ANCHORWEIGHT_RELEASE_CHANNEL,'alpha');const result=runFinalReleaseCheck({root});assert.equal(result.ok,false);assert.ok(result.failures.some(x=>x.includes('runtime version must be 3.0.0')));});
