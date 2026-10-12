#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const RUNNER = fileURLToPath(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEST_ROOT = path.join(ROOT, 'test');
const SUMMARY_FILE = path.join(ROOT, 'tmp', `.anchorweight-test-${process.pid}.json`);

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
  if (!files.length) return { success:true, counts:{tests:0,failed:0,passed:0,cancelled:0,skipped:0,todo:0,suites:0} };
  console.error(`[anchorweight-test] ${label}: ${files.length} file${files.length === 1 ? '' : 's'}`);
  const stream = run({ files, concurrency:1, ...options });
  let summary = null;
  stream.on('test:summary', value => { summary = value; });
  const reported = stream.compose(spec);
  reported.pipe(process.stdout, { end:false });
  await once(stream, 'end');
  await new Promise(resolve => setImmediate(resolve));
  const counts = summary?.counts || {tests:0,failed:0,passed:0,cancelled:0,skipped:0,todo:0,suites:0};
  return { success:summary?.success !== false && counts.failed === 0 && counts.cancelled === 0, counts };
}

function addCounts(total, part) {
  for (const key of ['tests','failed','passed','cancelled','skipped','todo','suites'])
    total[key] = (total[key] || 0) + (part?.[key] || 0);
}

async function flushOutput() {
  await Promise.all([
    new Promise(resolve => process.stdout.write('', resolve)),
    new Promise(resolve => process.stderr.write('', resolve))
  ]);
}

function replaceSelf(phase) {
  if (typeof process.execve !== 'function' || process.platform === 'win32') {
    throw new Error('constrained two-phase runner requires process.execve on this host');
  }
  process.execve(process.execPath, [process.execPath, RUNNER, `--aw-phase=${phase}`], process.env);
}

const files = collectTests(TEST_ROOT);
if (process.argv.includes('--list')) {
  const nested = files.filter(isNestedProcessTest);
  console.log(JSON.stringify({ files:files.length, nestedProcessFiles:nested.map(file => path.relative(ROOT,file).replaceAll('\\','/')) }, null, 2));
  process.exit(0);
}

const constrained = constrainedMode();
const phaseArg = process.argv.find(arg => arg.startsWith('--aw-phase='));
const phase = phaseArg ? phaseArg.slice('--aw-phase='.length) : '';
const total = {tests:0,failed:0,passed:0,cancelled:0,skipped:0,todo:0,suites:0};

console.error(`[anchorweight-test] node=${process.version} constrained=${constrained} files=${files.length}${phase ? ` phase=${phase}` : ''}`);

if (!constrained) {
  if (phase) {
    console.error('[anchorweight-test] internal phase flag is only valid in constrained mode');
    process.exit(2);
  }
  const result = await execute(files, {}, 'normal process-isolated suite');
  addCounts(total, result.counts);
  console.error(`[anchorweight-test] aggregate tests=${total.tests} pass=${total.passed} fail=${total.failed} cancelled=${total.cancelled} skipped=${total.skipped} todo=${total.todo}`);
  if (!result.success) process.exitCode = 1;
} else if (!phase) {
  // Do not spawn a child coordinator on constrained shared hosting. execve replaces
  // this process image, so the standard phase starts without increasing process
  // or thread count.
  await flushOutput();
  replaceSelf('standard');
} else if (phase === 'standard') {
  const standard = files.filter(file => !isNestedProcessTest(file));
  fs.mkdirSync(path.dirname(SUMMARY_FILE), { recursive:true });
  fs.rmSync(SUMMARY_FILE, { force:true });
  // Hotfix 2 proved this topology runs the standard suite on HawkHost: one Node
  // process, no per-file workers. The process is discarded with execve afterward.
  const result = await execute(standard, { isolation:'none' }, 'direct standard tests');
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify({ counts:result.counts, success:result.success }));
  if (!result.success) {
    addCounts(total, result.counts);
    console.error(`[anchorweight-test] aggregate tests=${total.tests} pass=${total.passed} fail=${total.failed} cancelled=${total.cancelled} skipped=${total.skipped} todo=${total.todo}`);
    fs.rmSync(SUMMARY_FILE, { force:true });
    process.exitCode = 1;
  } else {
    console.error('[anchorweight-test] standard phase complete; replacing process image before nested startup tests');
    await flushOutput();
    replaceSelf('nested');
  }
} else if (phase === 'nested') {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8')); }
  catch (err) {
    console.error(`[anchorweight-test] missing constrained standard-phase summary: ${err.message}`);
    process.exit(2);
  }
  fs.rmSync(SUMMARY_FILE, { force:true });
  addCounts(total, saved.counts);
  let success = saved.success !== false;
  const nested = files.filter(isNestedProcessTest);
  console.error(`[anchorweight-test] fresh nested phase: ${nested.length} files`);
  for (const file of nested) {
    const rel = path.relative(ROOT, file).replaceAll('\\','/');
    const result = await execute([file], { isolation:'none' }, `direct nested-process test ${rel}`);
    addCounts(total, result.counts);
    success = success && result.success;
  }
  console.error(`[anchorweight-test] aggregate tests=${total.tests} pass=${total.passed} fail=${total.failed} cancelled=${total.cancelled} skipped=${total.skipped} todo=${total.todo}`);
  if (!success) process.exitCode = 1;
} else {
  console.error(`[anchorweight-test] unknown internal phase: ${phase}`);
  process.exit(2);
}
