#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const include=[];
function walk(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(['node_modules','.git','data','backups','reports'].includes(e.name)) continue;
    const fp=path.join(dir,e.name);
    if(e.isDirectory()) walk(fp);
    else if(/\.(js|json|yml|yaml|md)$/.test(e.name) && !['SOURCE-MANIFEST.json'].includes(e.name)) include.push(fp);
  }
}
for(const entry of ['src','bin','test','.github','config']) { const d=path.join(root,entry); if(fs.existsSync(d)) walk(d); }
for(const entry of ['app.js','package.json','Dockerfile','docker-compose.yml']) { const f=path.join(root,entry); if(fs.existsSync(f)) include.push(f); }
let out=`AnchorWeight v1.2.0 — Plain Text Source Review Bundle\nGenerated: ${new Date().toISOString()}\n\n`;
for(const fp of [...new Set(include)].sort()){
  const rel=path.relative(root,fp).replaceAll('\\','/');
  out += `\n================================================================================\nFILE: ${rel}\n================================================================================\n`;
  out += fs.readFileSync(fp,'utf8')+'\n';
}
fs.writeFileSync(path.join(root,'SOURCE-REVIEW.txt'),out);
console.log(`Wrote SOURCE-REVIEW.txt (${include.length} files)`);
