'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','bey-catalog-tw07-mobile-preview.html'),'utf8');
test('mobile preview is zh-TW and clearly labeled as demonstration',()=>{
 assert.match(html,/lang="zh-Hant-TW"/);
 assert.match(html,/TW-07 模擬預覽/);
 assert.match(html,/僅展示介面與示例資料/);
 assert.match(html,/非完整 31 筆清單/);
 assert.match(html,/width=device-width,initial-scale=1/);
});
test('preview has functional search, priority filters and safe escaped card content',()=>{
 assert.match(html,/id="search"/);
 for(const p of ['all','P0','P1','P2'])assert.match(html,new RegExp('data-filter="'+p+'"'));
 assert.match(html,/addEventListener\('input',draw\)/);
 assert.match(html,/aria-pressed/);
 assert.match(html,/const esc=/);
 assert.match(html,/esc\(x.title\)/);
});
test('standalone preview cannot write to backend or claim approval',()=>{
 assert.doesNotMatch(html,/firebase\.firestore|fetch\(|XMLHttpRequest|https:\/\/arena\.bxh\.com\.tw/);
 assert.doesNotMatch(html,/data-action="(?:approve|publish|save)"/);
 assert.match(html,/不連線正式 Firebase/);
});
