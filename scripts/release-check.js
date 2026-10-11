#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const required=['README.md','SECURITY.md','ARCHITECTURE.md','THREAT-MODEL.md','CONFIGURATION.md','OPERATIONS.md','DEPLOYMENT.md','CLI.md','LICENSE','DISTRIBUTED-INTELLIGENCE.md','OPERATOR-GATEWAY.md','public/setup.html','src/setup.js','src/telemetry.js','src/gateway-policy.js','src/upstream-health.js','GATEWAY-PROTECTION.md','MULTI-ORIGIN-ROUTING.md','src/routing.js','test/unit/routing.test.js','test/multi-origin.integration.test.js','hub.js','src/declarative-config.js','test/unit/declarative-config.test.js','test/declarative-config.integration.test.js','DECLARATIVE-CONFIGURATION.md','APPLICATION-AUTH.md','src/app-auth.js','bin/app-auth.js','test/unit/app-auth.test.js','test/app-auth.integration.test.js','src/resilience.js','test/unit/resilience.test.js','test/resilience.integration.test.js','UPSTREAM-RESILIENCE.md','LIVE-TRAFFIC-OBSERVATORY.md','src/live-observatory.js','test/unit/live-observatory.test.js','test/live-observatory.integration.test.js','src/alerts.js','bin/alerts.js','test/unit/alerts.test.js','test/alerts.integration.test.js','ALERTS-AND-WEBHOOKS.md','config/examples/alerts-basic.json','INSTALLATION-AND-OPERATIONS.md','bin/operator.js','src/operator-experience.js','test/unit/operator-experience.test.js','test/operator-experience.integration.test.js','src/client-environment.js','test/unit/client-environment.test.js','CLIENT-ENVIRONMENT.md','ADAPTIVE-DECEPTION.md','src/adaptive-deception.js','test/unit/adaptive-deception.test.js','ADAPTIVE-INTERVENTION.md','src/adaptive-intervention.js','test/unit/adaptive-intervention.test.js','CLIENT-IDENTITY-SAFETY.md','src/client-identity.js','test/unit/client-identity.test.js','test/unit/client-identity-integration.test.js','test/unit/proxy-identity-safety.test.js','AGENT-IDENTITY.md','src/agent-identity.js','test/unit/agent-identity.test.js','test/unit/agent-identity-integration.test.js','AGENT-BEHAVIOR.md','src/agent-behavior.js','test/unit/agent-behavior.test.js','test/unit/agent-behavior-integration.test.js','TRAFFIC-SCORING.md','src/traffic-scoring.js','test/unit/traffic-scoring.test.js','test/unit/traffic-scoring-integration.test.js','AGENT-TRAFFIC-OBSERVATORY.md','src/agent-observatory.js','test/unit/agent-observatory.test.js','test/unit/agent-observatory-integration.test.js'];
const failures=[];
if(pkg.version!=='3.0.0-alpha.4') failures.push(`package version is ${pkg.version}`);
for(const file of required) if(!fs.existsSync(path.join(root,file))) failures.push(`missing ${file}`);
for (const entry of ['app.js','hub.js']) { try { execFileSync(process.execPath,['--check',path.join(root,entry)],{stdio:'pipe'}); } catch { failures.push(`${entry} syntax check failed`); } }
try { execFileSync(process.execPath,[path.join(root,'bin/anchorweight.js'),'version'],{stdio:'pipe'}); } catch { failures.push('CLI version command failed'); }
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
if(lock.version!=='3.0.0-alpha.4' || lock.packages?.['']?.version!=='3.0.0-alpha.4') failures.push('package-lock version mismatch');

const VERIFY=process.argv.includes('--verify');
if (process.argv.some(arg=>arg.startsWith('--') && arg!=='--verify')) failures.push('unsupported release-check argument');
const files=[];
const ignoredDirs=new Set(['.git','data','backups','reports','node_modules','tmp','coverage','.cache']);
const ignoredFiles=new Set(['SOURCE-MANIFEST.json','SOURCE-REVIEW.txt','main']);
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if (ignoredDirs.has(entry.name)||ignoredFiles.has(entry.name)||
        (entry.name.startsWith('.env')&&entry.name!=='.env.example')||
        /\.(?:log|bak|backup|zip|sqlite|sqlite-wal|sqlite-shm)$/.test(entry.name)) continue;
    const fp=path.join(dir,entry.name);
    if(entry.isSymbolicLink()) {failures.push(`symlink in release source: ${path.relative(root,fp)}`);continue;}
    if(entry.isDirectory())walk(fp);
    else if(entry.isFile())files.push(fp);
  }
}
walk(root);
const manifest=files.sort().map(fp=>({file:path.relative(root,fp).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')}));
const expected={version:'3.0.0-alpha.4',files:manifest};
const manifestFile=path.join(root,'SOURCE-MANIFEST.json');
if (VERIFY) {
  try {
    const current=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    if(JSON.stringify(current)!==JSON.stringify(expected)) failures.push('source manifest mismatch: run release:check and review changes before committing');
  } catch(err){ failures.push(`source manifest unavailable or invalid: ${err.message}`); }
} else if (!failures.length) {
  fs.writeFileSync(manifestFile,JSON.stringify(expected,null,2)+'\n');
}
if(failures.length){for(const f of failures)console.error('FAIL:',f);process.exit(1)}
console.log(`AnchorWeight v3.0.0-alpha.4 release ${VERIFY?'verification':'check'} PASS (${manifest.length} source files manifested)`);
