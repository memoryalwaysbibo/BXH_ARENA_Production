'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(process.env.BXH_M31_ROOT||process.cwd());
const index=fs.readFileSync(path.join(root,'index.html'));
const css=fs.readFileSync(path.join(root,'modules/mobile-overrides/styles.css'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'m3-mobile-overrides-manifest.json'),'utf8'));
function blob(b){return crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')}
if(blob(index)!=='99ab90be16347904f050c11ee7086cf11d367620')throw Error('candidate index blob mismatch');
if(crypto.createHash('sha256').update(css).digest('hex')!=='ba0781208f3ae093eeecf90519c9d0c9591df35d06e8c8c7aca60152daf52f53')throw Error('mobile CSS digest mismatch');
if(css.length!==10516)throw Error('mobile CSS byte length mismatch');
if(index.length!==2381048)throw Error('candidate index byte length mismatch');
const html=index.toString();
const link='<link id="bxh-mobile-overrides-m3-1" rel="stylesheet" href="modules/mobile-overrides/styles.css?v=20261002-m3-1">';
if((html.match(/bxh-mobile-overrides-m3-1/g)||[]).length!==1)throw Error('stylesheet link must be unique');
if(html.includes('/* v13.38.1: prevent mobile landing card CTA from being clipped */'))throw Error('old inline mobile CSS still present');
const rebuilt=Buffer.from(html.replace(link,'<style>'+css.toString()+'</style>'));
if(blob(rebuilt)!=='ac4ae95673e4d96546f1fa9683fb3557de93164f')throw Error('exact re-inline reconstruction mismatch');
if(manifest.candidate_index_blob!=='99ab90be16347904f050c11ee7086cf11d367620')throw Error('manifest candidate mismatch');
console.log('PASS M3-1 exact-byte mobile override extraction contract');
