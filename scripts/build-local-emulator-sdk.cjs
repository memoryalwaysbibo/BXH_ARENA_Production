'use strict';
// Test-only browser SDK. Install firebase@10.13.0 and esbuild in a scratch
// directory; pass that directory here. No production assets are generated.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]||''),outdir=path.join(root,'browser-sdk');
if(!process.argv[2])throw Error('Usage: node scripts/build-local-emulator-sdk.cjs <scratch npm directory>');
const version=require(path.join(root,'node_modules/firebase/package.json')).version;
if(version!=='10.13.0')throw Error('Expected Firebase SDK 10.13.0');
const esbuild=require(path.join(root,'node_modules/esbuild'));
const names=['app','auth','firestore','functions','app-check'];
const entries=path.join(root,'browser-entries');fs.mkdirSync(entries,{recursive:true});
for(const name of names)fs.writeFileSync(path.join(entries,'firebase-'+name+'.js'),`export * from 'firebase/${name}';\n`);
esbuild.buildSync({entryPoints:names.map(n=>path.join(entries,'firebase-'+n+'.js')),outdir,bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2020'});
fs.writeFileSync(path.join(outdir,'manifest.json'),JSON.stringify({version}));
console.log(outdir);
