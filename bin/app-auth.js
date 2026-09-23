#!/usr/bin/env node
/**
 * Local operator-only credential management. Do not run through the website.
 * The key is shown once, passwords are read without echo on a TTY, and the
 * private policy file is replaced atomically with a .previous copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { makeBasicCredential, makeApiCredential, validateAuthDocument,
  validateAuthPath, MAX_AUTH_BYTES } from '../src/app-auth.js';

function usage() {
  console.log('Usage: node bin/app-auth.js init | list | add-basic <path> <user> | add-key <path> <label>');
  console.log('Use AW_APP_AUTH_FILE to select a private JSON file under ./data/.');
}

async function hiddenPassword() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw Error('basic password input requires a terminal; never pass passwords as CLI arguments');
  }
  process.stderr.write('Password (12-256 bytes; hidden): ');
  return new Promise((resolve, reject) => {
    let data = '';
    const input = process.stdin;
    input.setRawMode(true);input.resume();input.setEncoding('utf8');
    function done(error) {
      input.off('data', onData);input.setRawMode(false);input.pause();process.stderr.write('\n');
      if (error) reject(error);else resolve(data);
    }
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {done();return;}
        if (char === '\u0003' || char === '\u0004') {done(Error('password_input_cancelled'));return;}
        if (char === '\u007f' || char === '\b') {data=data.slice(0,-1);continue;}
        if (Buffer.byteLength(data+char) > 256) {done(Error('password_too_long'));return;}
        if (/^[\x20-\x7e]$/.test(char)) data+=char;
      }
    }
    input.on('data',onData);
  });
}

function filePath(config) {
  const file = path.resolve(config.appAuthFile);
  if (!file.startsWith(`${path.resolve('data')}${path.sep}`) || !file.endsWith('.json'))
    throw Error('auth_file_must_be_private_json_in_data');
  return file;
}
function read(file) {
  if (!fs.existsSync(file)) throw Error('no_auth_file_run_init_first');
  const fd=fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW||0));
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile() || stat.size>MAX_AUTH_BYTES)throw Error('invalid_auth_file');
    const bytes=Buffer.alloc(stat.size+1);const n=fs.readSync(fd,bytes,0,bytes.length,0);
    if(n!==stat.size)throw Error('invalid_auth_file');
    return JSON.parse(bytes.subarray(0,n).toString('utf8'));
  }finally{fs.closeSync(fd);}
}
function write(file,doc,config) {
  validateAuthDocument(doc,config);
  const encoded=JSON.stringify(doc,null,2)+'\n';
  if(Buffer.byteLength(encoded)>MAX_AUTH_BYTES)throw Error('auth_file_too_large');
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${process.pid}.tmp`;
  // Avoid trusting an existing symlink at the destination or previous copy.
  if(fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())throw Error('auth_file_symlink');
  try {
    fs.writeFileSync(temp,encoded,{mode:0o600,flag:'wx'});
    if(fs.existsSync(file)) {
      const backup=`${file}.previous`;
      fs.copyFileSync(file,`${temp}.previous`,fs.constants.COPYFILE_EXCL);
      fs.chmodSync(`${temp}.previous`,0o600);
      if(fs.existsSync(backup) && fs.lstatSync(backup).isSymbolicLink())throw Error('auth_backup_symlink');
      fs.renameSync(`${temp}.previous`,backup);
    }
    fs.renameSync(temp,file);
  }finally{
    try{fs.unlinkSync(temp)}catch{}
    try{fs.unlinkSync(`${temp}.previous`)}catch{}
  }
}
async function main() {
  const [command,route,id,...extra]=process.argv.slice(2);
  if(extra.length || !['init','list','add-basic','add-key'].includes(command)) {usage();process.exitCode=2;return;}
  const config=loadConfig();
  const file=filePath(config);
  if(command==='init') {
    if(fs.existsSync(file))throw Error('auth_file_already_exists');
    write(file,{version:1,policies:[]},config);
    console.log('Created private authentication file:',file);
    return;
  }
  const doc=read(file);
  validateAuthDocument(doc,config);
  if(command==='list') {
    for(const policy of doc.policies)console.log(`${policy.path}  ${policy.mode}  ${policy.credentials.map(c=>c.id).join(',')}`);
    if(!doc.policies.length)console.log('No application authentication policies.');
    return;
  }
  if(!route || !id) {usage();process.exitCode=2;return;}
  validateAuthPath(route,config.basePath);
  const mode=command==='add-key'?'api_key':'basic';
  let policy=doc.policies.find(item=>item.path===route);
  if(policy && policy.mode!==mode)throw Error('path_already_uses_different_auth_mode');
  if(policy?.credentials.some(c=>c.id===id))throw Error('credential_id_already_exists');
  const result=mode==='api_key'?makeApiCredential(id):{credential:makeBasicCredential(id,await hiddenPassword())};
  if(!policy){policy={path:route,mode,credentials:[]};doc.policies.push(policy);}
  policy.credentials.push(result.credential);
  write(file,doc,config);
  console.log(`Saved ${mode} credential ${id} for ${route}. Restart AnchorWeight to apply.`);
  if(result.key)console.log('COPY THIS API KEY NOW; IT WILL NOT BE DISPLAYED AGAIN:\n'+result.key);
}
main().catch(error=>{console.error('Authentication configuration:',error.message);process.exitCode=1;});
