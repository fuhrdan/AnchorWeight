#!/usr/bin/env node
import { loadConfig } from '../src/config.js';
import { buildAiAgentRobots, describeAiAgentPolicy } from '../src/ai-agent-policy.js';

const config=loadConfig();
const robots=buildAiAgentRobots(config);
const descriptor=describeAiAgentPolicy(config);
console.error(`AnchorWeight AI Agent Controls: ${descriptor.enabled?'enabled':'disabled'}, shadow=${descriptor.shadowMode}, enforcement=${descriptor.enforcementEnabled}`);
if(!robots) {
  console.log('# No AI-agent-specific Disallow groups are currently requested.');
  process.exit(0);
}
console.log('# AnchorWeight v3.1 suggested AI-agent robots.txt directives');
console.log('# Merge these with your existing robots.txt; do not replace unrelated rules.');
console.log(robots.trimEnd());
