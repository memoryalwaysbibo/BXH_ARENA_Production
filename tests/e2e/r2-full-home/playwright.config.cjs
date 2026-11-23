'use strict';
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:__dirname,testMatch:/r2-full-home\.e2e\.cjs$/,workers:1,
 fullyParallel:false,retries:0,timeout:90000,expect:{timeout:12000},
 reporter:[['list']],use:{browserName:'chromium',headless:true,serviceWorkers:'block'}
});
