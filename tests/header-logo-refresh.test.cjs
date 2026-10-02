'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const core=fs.readFileSync(path.join(__dirname,'..','modules','main-app','core.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','modules','main-css','core-competition.css'),'utf8');
const source=html+'\n'+core+'\n'+css;

const logoButton='class="logo-wrap logo-refresh-button" data-action="header-refresh"';
assert.equal((source.match(/class="logo-wrap logo-refresh-button" data-action="header-refresh"/g)||[]).length,4,'all shared header logos must be refresh buttons');
assert(source.includes('aria-label="重新整理並讀取最新資訊"'),'logo refresh accessibility label missing');
assert(source.includes('function refreshLatestFromHeaderLogo(target)'),'header refresh handler missing');
assert(source.includes('if(action==="header-refresh"){refreshLatestFromHeaderLogo(target);return;}'),'header refresh action dispatch missing');
assert(source.includes('u.searchParams.set("bxh_refresh",String(Date.now()))'),'refresh must cache-bust current page');
assert(source.includes('location.replace(u.toString())'),'refresh must reload current URL');
assert(source.includes('sessionStorage.setItem("bxh_header_refresh_at"'),'refresh completion marker missing');
assert(source.includes('showToast("已讀取最新資訊")'),'refresh completion feedback missing');
assert(source.includes('registrationFormDraftDirty'),'refresh must protect unsaved registration draft');
assert(source.includes('.logo-refresh-button.is-refreshing'),'refresh visual feedback missing');

console.log('PASS header logo refresh control');
