export const PROJECT='bxh-hc-test';
export const ORIGINS=Object.freeze(['https://bxh-hc-test-hc01.web.app','https://bxh-hc-test-hc01.firebaseapp.com']);
export const ENDPOINT='https://asia-east1-bxh-hc-test.cloudfunctions.net/hc01Command';
export function validateConfig(config,origin){
  if(!ORIGINS.includes(origin)||config?.enabled!==true||config.projectId!==PROJECT||config.authDomain!==PROJECT+'.firebaseapp.com'||
    typeof config.apiKey!=='string'||!/^AIza[A-Za-z0-9_-]{35}$/.test(config.apiKey)||
    typeof config.appId!=='string'||!/^1:\d+:web:[a-f0-9]+$/.test(config.appId)||
    typeof config.appCheckSiteKey!=='string'||!/^[A-Za-z0-9_-]{20,200}$/.test(config.appCheckSiteKey))throw Error('cloud-test-not-configured');
  return Object.freeze({enabled:true,projectId:PROJECT,authDomain:config.authDomain,apiKey:config.apiKey,appId:config.appId,appCheckSiteKey:config.appCheckSiteKey});
}
