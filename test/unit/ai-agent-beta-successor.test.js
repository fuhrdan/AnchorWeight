import test from 'node:test';
import assert from 'node:assert/strict';
import { betaPrerequisiteReleaseChannel } from '../../scripts/ai-agent-beta-check.js';

test('RC.1 evaluates the preserved beta prerequisite using beta channel semantics',()=>{
  assert.equal(betaPrerequisiteReleaseChannel('3.1.0-rc.1','rc'),'beta');
});

test('non-RC channels are not rewritten by the beta prerequisite adapter',()=>{
  assert.equal(betaPrerequisiteReleaseChannel('3.1.0-beta.2','beta'),'beta');
  assert.equal(betaPrerequisiteReleaseChannel('3.1.0','stable'),'stable');
});
