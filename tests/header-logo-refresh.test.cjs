'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const core=fs.readFileSync(path.join(__dirname,'..','modules','main-app','core.js'),'utf8');

const logoButton='class="logo-wrap logo-refresh-button" data-action="header-refresh"';
const logoCount=(core.match(/class="logo-wrap logo-refresh-button" data-action="header-refresh"/g)||[]).length;
assert(logoCount>=4,'all current shared header logos must be refresh buttons');
assert(core.includes('aria-label="重新整理並讀取最新資訊"'),'logo refresh accessibility label missing');
assert(core.includes('function refreshLatestFromHeaderLogo(target)'),'header refresh handler missing');
assert(core.includes('if(action==="header-refresh"){refreshLatestFromHeaderLogo(target);return;}'),'header refresh action dispatch missing');
assert(core.includes('u.searchParams.set("bxh_refresh",String(Date.now()))'),'refresh must cache-bust current page');
assert(core.includes('location.replace(u.toString())'),'refresh must reload current URL');
assert(core.includes('sessionStorage.setItem("bxh_header_refresh_at"'),'refresh completion marker missing');
assert(core.includes('showToast("已讀取最新資訊")'),'refresh completion feedback missing');
assert(core.includes('registrationFormDraftDirty'),'refresh must protect unsaved registration draft');
assert(html.includes('referee-score-v2.css') && core.includes('is-refreshing'),'refresh visual feedback wiring missing');

console.log('PASS header logo refresh control');
