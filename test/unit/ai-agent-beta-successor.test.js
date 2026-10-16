import test from 'node:test';
import assert from 'node:assert/strict';
import { betaPrerequisiteReleaseChannel } from '../../scripts/ai-agent-beta-check.js';

test('GA evaluates the preserved beta prerequisite using beta channel semantics',()=>{
  assert.equal(betaPrerequisiteReleaseChannel('3.1.0','stable'),'beta');
});

test('historical beta channel remains beta',()=>{
  assert.equal(betaPrerequisiteReleaseChannel('3.1.0-beta.2','beta'),'beta');
});
