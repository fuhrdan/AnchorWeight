#!/usr/bin/env node
/** Local-only operator workflow. No network listener and no cPanel environment edits. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../src/config.js';
import { canonicalOrigin } from '../src/setup.js';
import { diagnose, exportGateway, importGateway } from '../src/operator-experience.js';

const help=`AnchorWeight 2.6 local operator tools
  npm run doctor -- [--json] [--probe]           Read-only installation checks
  npm run setup                                  Interactive first-run plan (TTY)
  npm run setup -- --mode trap                   Print trap-only setup plan
  npm run setup -- --mode proxy --origin URL     Print proxy setup plan
  npm run config:export -- [--format json|yaml] [--out FILE]
  npm run config:import -- --from FILE           Validate only (default)
  npm run config:import -- --from FILE --apply --confirm-stopped
  npm run config:rollback -- --apply --confirm-stopped

An import/rollback requires AW_DECLARATIVE_ENABLED=true, stopped app confirmation,
and a private data directory. Restart the cPanel app to load the new file.
Secrets never appear in exports, diagnostics, or command-line flags.`;

function parse(argv,allowed) {
  const options={};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(!allowed.includes(flag))throw Error(`Unknown option ${flag}`);
    if(['--json','--probe','--apply','--confirm-stopped','--show-secrets'].includes(flag))options[flag]=true;
    else {
      if(!argv[i+1] || argv[i+1].startsWith('--'))throw Error(`${flag} requires a value`);
      options[flag]=argv[++i];
    }
  }
  return options;
}

async function setup(argv) {
  const a=parse(argv,['--mode','--origin','--public-host','--show-secrets']);
  const interactive=stdin.isTTY && !a['--mode'];
  const prompt=interactive?readline.createInterface({input:stdin,output:stdout}):null;
  let mode=a['--mode'];let origin=a['--origin'];let publicHost=a['--public-host'];
  try {
    if(prompt) {
      mode=(await prompt.question('Installation mode (trap/proxy) [trap]: ')).trim()||'trap';
      if(mode==='proxy')origin=(await prompt.question('Private upstream root URL: ')).trim();
      publicHost=(await prompt.question('Public AnchorWeight hostname (optional): ')).trim();
    }
  } finally {prompt?.close();}
  if(!['trap','proxy'].includes(mode))throw Error('setup_requires_mode_trap_or_proxy');
  if(mode==='proxy')origin=canonicalOrigin(origin);
  if(publicHost && (!/^[a-z0-9.-]{1,253}$/i.test(publicHost) || publicHost.includes('..')))
    throw Error('invalid_public_hostname');
  console.log('\nAnchorWeight v2.6 first-run plan (no settings were changed)');
  console.log('1. Select Node.js 22 in cPanel and create an app pointing to this folder, startup app.js.');
  console.log('2. Configure the following environment variables in cPanel, NOT in Git:');
  console.log(`   AW_PROXY_ENABLED=${mode==='proxy'?'true':'false'}`);
  if(mode==='proxy')console.log(`   AW_ORIGIN_URL=${origin}`);
  if(publicHost)console.log(`   AW_SETUP_PUBLIC_HOST=${publicHost}`);
  console.log('   AW_SHADOW_MODE=true');
  console.log('   AW_APP_AUTH_ENABLED=false');
  console.log('   AW_ALERTS_ENABLED=false');
  if(mode==='proxy')console.log('   Keep the origin private; do not let clients bypass AnchorWeight.');
  if(interactive||a['--show-secrets']) {
    console.log('   AW_SECRET='+crypto.randomBytes(32).toString('hex'));
    console.log('   AW_DASHBOARD_TOKEN='+crypto.randomBytes(32).toString('hex'));
    console.log('   Secrets shown once; copy to cPanel privately and do not commit or paste them.');
  } else console.log('   Generate AW_SECRET and AW_DASHBOARD_TOKEN using a secure random source.');
  console.log('3. Run npm run doctor, then node --test --test-concurrency=1 and npm run release:verify.');
  console.log('4. Start the cPanel app. Check /live, /ready, /dashboard.html and /setup.html.');
  console.log('5. Enable additional policies one at a time after backing up your working installation.');
}

async function main() {
  const [cmd='help',...argv]=process.argv.slice(2);
  if(cmd==='help'||cmd==='--help'){console.log(help);return;}
  if(cmd==='setup'){await setup(argv);return;}
  const config=loadConfig();
  if(cmd==='doctor'){
    const opts=parse(argv,['--json','--probe']);
    const result=await diagnose(config,{probe:!!opts['--probe']});
    if(opts['--json'])console.log(JSON.stringify(result,null,2));
    else {
      console.log('AnchorWeight v2.6 installation doctor (read-only)');
      for(const item of result.checks) {
        console.log(`${item.status.padEnd(4)} ${item.name}: ${item.detail}`);
        if(item.status!=='PASS' && item.action)console.log(`     Next: ${item.action}`);
      }
      console.log(`Result: ${result.summary.pass} PASS, ${result.summary.warn} WARN, ${result.summary.fail} FAIL, ${result.summary.skip} SKIP`);
    }
    if(!result.ok)process.exitCode=1;
    return;
  }
  if(cmd==='export'){
    const opts=parse(argv,['--format','--out']);
    const format=opts['--format'] || 'json';
    const content=exportGateway(config,format);
    if(!opts['--out']){stdout.write(content);return;}
    const file=path.resolve(opts['--out']);
    fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
    console.log(`Gateway-only export saved: ${file} (no credentials or evidence)`);
    return;
  }
  if(cmd==='import'||cmd==='rollback'){
    const opts=parse(argv,cmd==='import'?['--from','--apply','--confirm-stopped']:['--apply','--confirm-stopped']);
    if(cmd==='rollback' && !opts['--apply'])throw Error('rollback_requires_apply');
    const result=importGateway(config,opts['--from'],{apply:!!opts['--apply'],
      confirmStopped:!!opts['--confirm-stopped'],rollback:cmd==='rollback'});
    console.log(JSON.stringify(result,null,2));
    if(!result.applied)console.log('Validation only: no files or running routes changed.');
    else console.log('File updated. Restart the STOPPED app in cPanel to apply routing changes.');
    return;
  }
  throw Error(`Unknown command ${cmd}`);
}
main().catch(err=>{console.error(`AnchorWeight operator: ${err.message}`);process.exitCode=1;});
