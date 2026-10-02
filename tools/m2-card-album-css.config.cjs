'use strict';
const root=process.env.BXH_M2_ROOT||process.cwd();
module.exports={
  testDir:'.',
  testMatch:'m2-card-album-css.spec.cjs',
  timeout:30000,
  use:{baseURL:'http://127.0.0.1:4184',headless:true},
  webServer:{command:'python3 -m http.server 4184 --bind 127.0.0.1 --directory '+JSON.stringify(root),url:'http://127.0.0.1:4184/tools/m2-card-album-css-fixture.html',reuseExistingServer:false,timeout:30000}
};
