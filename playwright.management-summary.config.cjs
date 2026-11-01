const config=require('./playwright.config.cjs');
module.exports={...config,testMatch:'management-loading.spec.cjs',retries:0};
