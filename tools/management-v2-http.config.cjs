'use strict';
const {defineConfig}=require('@playwright/test');
const path=require('node:path');
module.exports=defineConfig({
 testDir:__dirname,testMatch:'management-v2-http.spec.cjs',timeout:30000,
 fullyParallel:false,workers:1,retries:0,reporter:[['list']],
 outputDir:process.env.BXH_PILOT_RESULTS||path.join(process.cwd(),'v2-http-results'),
 use:{baseURL:'http://127.0.0.1:4183',browserName:'chromium',serviceWorkers:'block',screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:{command:'node '+JSON.stringify(path.join(__dirname,'management-v2-http-server.cjs')),url:'http://127.0.0.1:4183/fixture',reuseExistingServer:false,timeout:15000},
});
