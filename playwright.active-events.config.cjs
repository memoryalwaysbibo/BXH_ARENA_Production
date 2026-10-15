const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests/e2e',testMatch:'active-events.candidate.cjs',
  outputDir:'test-results/active-events-run',timeout:30000,workers:1,retries:0,reporter:'list',
  use:{baseURL:'http://127.0.0.1:4175',serviceWorkers:'block',screenshot:'only-on-failure',trace:'retain-on-failure'},
  projects:[
    {name:'desktop-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900},launchOptions:{...(process.env.BXH_TEST_CHROMIUM?{executablePath:process.env.BXH_TEST_CHROMIUM}:{}),args:['--no-sandbox']}}},
    {name:'iphone-webkit',use:{...devices['iPhone 14']}},
    {name:'android-chromium',use:{...devices['Pixel 7'],launchOptions:{...(process.env.BXH_TEST_CHROMIUM?{executablePath:process.env.BXH_TEST_CHROMIUM}:{}),args:['--no-sandbox']}}}
  ],
  webServer:{command:'PORT=4175 node tests/e2e/static-server.cjs',url:'http://127.0.0.1:4175',reuseExistingServer:false}
});
