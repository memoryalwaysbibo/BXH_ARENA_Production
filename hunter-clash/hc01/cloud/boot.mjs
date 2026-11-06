import{validateConfig}from'./config.mjs';
import{createCloudTransport}from'./transport.mjs';
import{mountMobile}from'./mobile.mjs';
const root=document.querySelector('main');
try{
  const response=await fetch('/cloud/client-config.json',{cache:'no-store'});if(!response.ok)throw Error('configuration-unavailable');
  const config=validateConfig(await response.json(),location.origin);
  const sdk=await import('./firebase-sdk.mjs');
  const app=sdk.initializeApp({projectId:config.projectId,apiKey:config.apiKey,authDomain:config.authDomain,appId:config.appId},'hc01-isolated-test');
  const auth=sdk.getAuth(app);await sdk.setPersistence(auth,sdk.browserSessionPersistence);
  const appCheck=sdk.initializeAppCheck(app,{provider:new sdk.ReCaptchaEnterpriseProvider(config.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
  const runtime={auth,transport:createCloudTransport({config,origin:location.origin,auth,getAppCheckToken:()=>sdk.getToken(appCheck)}),
    watch:callback=>sdk.onAuthStateChanged(auth,callback),login:(email,password)=>sdk.signInWithEmailAndPassword(auth,email,password),logout:()=>sdk.signOut(auth)};
  mountMobile(root,runtime);
}catch{root.querySelector('#message').textContent='內測入口尚未啟用或設定未完成，請聯絡測試主持者。';}
