'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

const logoButton='class="logo-wrap logo-refresh-button" data-action="header-refresh"';
assert.equal((html.match(/class="logo-wrap logo-refresh-button" data-action="header-refresh"/g)||[]).length,5,'all shared header logos must be refresh buttons');
assert(html.includes('aria-label="重新整理並讀取最新資訊"'),'logo refresh accessibility label missing');
assert(html.includes('function refreshLatestFromHeaderLogo(target)'),'header refresh handler missing');
assert(html.includes('if(action==="header-refresh"){refreshLatestFromHeaderLogo(target);return;}'),'header refresh action dispatch missing');
assert(html.includes('u.searchParams.set("bxh_refresh",String(Date.now()))'),'refresh must cache-bust current page');
assert(html.includes('location.replace(u.toString())'),'refresh must reload current URL');
assert(html.includes('sessionStorage.setItem("bxh_header_refresh_at"'),'refresh completion marker missing');
assert(html.includes('showToast("已讀取最新資訊")'),'refresh completion feedback missing');
assert(html.includes('registrationFormDraftDirty'),'refresh must protect unsaved registration draft');
assert(html.includes('.logo-refresh-button.is-refreshing'),'refresh visual feedback missing');

console.log('PASS header logo refresh control');
