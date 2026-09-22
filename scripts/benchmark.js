#!/usr/bin/env node
/**
 * Repeatable HTTP baseline against YOUR OWN localhost AnchorWeight instance.
 * Usage: node scripts/benchmark.js http://127.0.0.1:8080/health 500 10
 * Not a capacity claim; compare equal hardware/traffic with backend JSON/SQLite.
 */
import { performance } from 'node:perf_hooks';
import http from 'node:http';
import https from 'node:https';

const url = new URL(process.argv[2] || 'http://127.0.0.1:8080/health');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Benchmark only supports localhost. Do not run unsolicited load tests against public sites.');
}
const requests = Number(process.argv[3] || 500);
const concurrency = Number(process.argv[4] || 10);
if (!Number.isInteger(requests) || requests < 1 || requests > 100000 ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  throw new Error('requests must be 1-100000 and concurrency 1-100');
}
const agent = url.protocol === 'https:' ? new https.Agent({keepAlive:true,maxSockets:concurrency}) : new http.Agent({keepAlive:true,maxSockets:concurrency});
const transport = url.protocol === 'https:' ? https : http;
let index = 0, failed = 0, succeeded = 0;
const latencies = [];
const request = () => new Promise(resolve => {
  const start = performance.now();
  const req = transport.get(url,{agent,timeout:10000},res => {
    res.resume();
    res.on('end',()=>{latencies.push(performance.now()-start);if(res.statusCode !== 200) failed++;else succeeded++;resolve();});
    res.on('error',()=>{failed++;resolve();});
  });
  req.on('timeout',()=>req.destroy(new Error('timeout')));
  req.on('error',()=>{failed++;resolve();});
});
const started = performance.now();
await Promise.all(Array.from({length:Math.min(concurrency,requests)},async()=>{
  while(index < requests) { index++; await request(); }
}));
agent.destroy();
latencies.sort((a,b)=>a-b);
const duration = (performance.now()-started)/1000;
const percentile = (q) => latencies.length ? Number(latencies[Math.min(latencies.length-1,Math.ceil(q*latencies.length)-1)].toFixed(2)) : null;
console.log(JSON.stringify({url:url.href,requests,concurrency,successful:succeeded,failed,durationSeconds:Number(duration.toFixed(2)),requestsPerSecond:Number((requests/duration).toFixed(2)),latencyMs:{p50:percentile(.50),p95:percentile(.95),p99:percentile(.99)}},null,2));
if(failed)process.exitCode=1;
