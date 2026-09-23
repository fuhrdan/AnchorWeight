#!/usr/bin/env node
/** Local-only alert configuration helper. Never prints keys or contacts destinations. */
import fs from 'node:fs';
import path from 'node:path';
import {loadConfig} from '../src/config.js';
import {validateConfig} from '../src/config-schema.js';
import {loadAlertDocument} from '../src/alerts.js';

const command=process.argv[2];
if(!['init','validate'].includes(command)){
 console.error('Usage: node bin/alerts.js init|validate');process.exitCode=2;
}else{
 try{
  const config=loadConfig();
  const file=path.resolve(config.alertsFile);
  const dir=path.resolve('./data');
  if(!file.startsWith(dir+path.sep)||!file.endsWith('.json'))throw Error('alerts_file_must_be_json_in_data');
  if(command==='init'){
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    const example=fs.readFileSync(new URL('../config/examples/alerts-basic.json',import.meta.url),'utf8');
    fs.writeFileSync(file,example,{mode:0o600,flag:'wx'}); // Never overwrite operator changes.
    console.log('Created private example:',file);
    console.log('Edit the placeholder destination, approve its host in cPanel, then run: node bin/alerts.js validate');
  }else{
    const enabled={...config,alertsEnabled:true};
    const validation=validateConfig(enabled);
    if(!validation.valid)throw Error(validation.errors.join('; '));
    const doc=loadAlertDocument(enabled);
    console.log(`Alert configuration VALID (${doc.rules.length} rules, ${doc.webhooks.size} ${doc.webhooks.size === 1 ? 'destination' : 'destinations'}). No network requests made.`);
  }
 }catch(err){console.error('Alert configuration ERROR:',err.message);process.exitCode=1;}
}
