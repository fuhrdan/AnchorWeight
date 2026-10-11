#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEST_ROOT = path.join(ROOT, 'test');

function collectTests(dir, retVal = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTests(full, retVal);
    else if (entry.isFile() && entry.name.endsWith('.test.js')) retVal.push(full);
  }
  return retVal;
}

function isNestedProcessTest(file) {
  const source = fs.readFileSync(file, 'utf8');
  return /(?:node:child_process|['"]child_process['"])/.test(source);
}

function constrainedMode() {
  const explicit = String(process.env.AW_TEST_CONSTRAINED || '').toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(explicit)) return true;
  if (['0', 'false', 'no', 'off'].includes(explicit)) return false;
  const uv = String(process.env.UV_THREADPOOL_SIZE || '');
  const nodeOptions = String(process.env.NODE_OPTIONS || '');
  return uv === '1' && /--v8-pool-size(?:=|\s+)1(?:\s|$)/.test(nodeOptions);
}

async function execute(files, options, label) {
  if (!files.length) return { success: true, counts: { tests:0, failed:0, passed:0, cancelled:0, skipped:0, todo:0, suites:0 } };

  console.error(`[anchorweight-test] ${label}: ${files.length} file${files.length === 1 ? '' : 's'}`);
  const stream = run({ files, concurrency: 1, ...options });
  let summary = null;
  // Node emits test:summary more than once (per-file/intermediate and final).
  // Keep the last one, but do not treat any summary event as completion.
  stream.on('test:summary', value => { summary = value; });
  const reported = stream.compose(spec);
  reported.pipe(process.stdout, { end: false });
  // The raw TestsStream 'end' event is the authoritative completion signal.
  // Waiting for reporter 'end' can hang under isolation:none; waiting for the
  // first test:summary can return early while process-isolated workers remain.
  await once(stream, 'end');
  await new Promise(resolve => setImmediate(resolve));

  const counts = summary?.counts || { tests:0, failed:0, passed:0, cancelled:0, skipped:0, todo:0, suites:0 };
  return { success: summary?.success !== false && counts.failed === 0 && counts.cancelled === 0, counts };
}

function addCounts(total, part) {
  for (const key of ['tests','failed','passed','cancelled','skipped','todo','suites'])
    total[key] = (total[key] || 0) + (part?.[key] || 0);
}

const files = collectTests(TEST_ROOT);
if (process.argv.includes('--list')) {
  const nested = files.filter(isNestedProcessTest);
  console.log(JSON.stringify({ files: files.length, nestedProcessFiles: nested.map(file => path.relative(ROOT, file).replaceAll('\\', '/')) }, null, 2));
  process.exit(0);
}
const constrained = constrainedMode();
const major = Number(process.versions.node.split('.')[0]);
const total = { tests:0, failed:0, passed:0, cancelled:0, skipped:0, todo:0, suites:0 };
let success = true;

console.error(`[anchorweight-test] node=${process.version} constrained=${constrained} files=${files.length}`);

if (!constrained) {
  const result = await execute(files, {}, 'normal process-isolated suite');
  addCounts(total, result.counts);
  success = result.success;
} else {
  if (major < 22) {
    console.error('[anchorweight-test] constrained in-process mode requires Node 22+; falling back to process isolation');
    const result = await execute(files, {}, 'fallback process-isolated suite');
    addCounts(total, result.counts);
    success = result.success;
  } else {
    const nested = files.filter(isNestedProcessTest);
    const standard = files.filter(file => !isNestedProcessTest(file));

    // Keep normal isolation for the majority of tests. These files do not launch
    // child processes themselves and already run successfully on constrained hosts.
    const standardResult = await execute(standard, {}, 'standard isolated tests');
    addCounts(total, standardResult.counts);
    success = success && standardResult.success;

    // The files below intentionally exercise real CLI/server child processes.
    // Loading each test file directly into this runner removes Node's extra
    // per-file test worker, lowering peak process/thread pressure by one process
    // without converting resource failures into skips.
    for (const file of nested) {
      const rel = path.relative(ROOT, file).replaceAll('\\', '/');
      const result = await execute([file], { isolation: 'none' }, `direct nested-process test ${rel}`);
      addCounts(total, result.counts);
      success = success && result.success;
    }
  }
}

console.error(`[anchorweight-test] aggregate tests=${total.tests} pass=${total.passed} fail=${total.failed} cancelled=${total.cancelled} skipped=${total.skipped} todo=${total.todo}`);
if (!success) process.exitCode = 1;
