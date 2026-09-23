#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const required=['README.md','SECURITY.md','ARCHITECTURE.md','THREAT-MODEL.md','CONFIGURATION.md','OPERATIONS.md','DEPLOYMENT.md','CLI.md','LICENSE'];
const failures=[];
if(pkg.version!=='1.5.0') failures.push(`package version is ${pkg.version}`);
for(const file of required) if(!fs.existsSync(path.join(root,file))) failures.push(`missing ${file}`);
try { execFileSync(process.execPath,['--check',path.join(root,'app.js')],{stdio:'pipe'}); } catch { failures.push('app.js syntax check failed'); }
try { execFileSync(process.execPath,[path.join(root,'bin/anchorweight.js'),'version'],{stdio:'pipe'}); } catch { failures.push('CLI version command failed'); }
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
if(lock.version!=='1.5.0' || lock.packages?.['']?.version!=='1.5.0') failures.push('package-lock version mismatch');

const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','data','backups','reports','node_modules','tmp'].includes(e.name) || ['SOURCE-MANIFEST.json','SOURCE-REVIEW.txt','main'].includes(e.name))continue;const fp=path.join(dir,e.name);if(e.isDirectory())walk(fp);else files.push(fp)}}
walk(root);
const manifest=files.sort().map(fp=>({file:path.relative(root,fp).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex')}));
fs.writeFileSync(path.join(root,'SOURCE-MANIFEST.json'),JSON.stringify({version:'1.5.0',files:manifest},null,2));

if(failures.length){for(const f of failures)console.error('FAIL:',f);process.exit(1)}
console.log(`AnchorWeight v1.5.0 release check PASS (${manifest.length} source files manifested)`);
