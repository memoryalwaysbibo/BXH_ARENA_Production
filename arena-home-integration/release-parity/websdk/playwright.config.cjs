'use strict';
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:__dirname,testMatch:/r2-wire\.e2e\.cjs$/,timeout:90000,expect:{timeout:12000},
 workers:1,retries:0,reporter:[['list']],use:{browserName:'chromium',headless:true,serviceWorkers:'block'}
});
