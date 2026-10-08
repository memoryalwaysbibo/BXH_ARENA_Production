const base=require('./playwright.deep-e2e.config.cjs');
module.exports={...base,testMatch:/court-retirement\.e2e\.cjs/,timeout:180000,use:{...base.use,launchOptions:{args:['--no-sandbox']}}};
