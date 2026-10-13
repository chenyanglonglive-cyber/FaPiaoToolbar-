import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd();
async function jsFiles(directory){const files=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory())files.push(...await jsFiles(target));else if(entry.name.endsWith('.js'))files.push(target);}return files;}
let errors=0;
for(const file of [...await jsFiles(path.join(root,'extension')),...await jsFiles(path.join(root,'tools')),...await jsFiles(path.join(root,'tests'))]){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status){process.stderr.write(result.stderr);errors++;}}
const manifest=JSON.parse((await fs.readFile('extension/manifest.json','utf8')).replace(/^\uFEFF/,''));
if(manifest.manifest_version!==3||manifest.host_permissions||manifest.permissions.includes('cookies')){process.stderr.write('Unexpected manifest permissions\n');errors++;}
for(const relative of ['extension/core.js','extension/page-adapter.js','extension/transport.js']){const text=await fs.readFile(relative,'utf8');if(/\bfetch\s*\(|XMLHttpRequest/.test(text)){process.stderr.write(`Unexpected remote request: ${relative}\n`);errors++;}}
process.stdout.write(`Syntax and package checks: ${errors?`${errors} errors`:'passed'}\n`);process.exitCode=errors?1:0;
