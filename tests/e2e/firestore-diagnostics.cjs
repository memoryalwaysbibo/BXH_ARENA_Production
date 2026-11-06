'use strict';
// Optional diagnostics record operation names and synthetic document paths only;
// never log request bodies, credentials, tokens or document contents.
exports.install = test => {
  if(process.env.BXH_TEST_TRACE_FIRESTORE!=='1')return;
  const events=new WeakMap();
  test.beforeEach(async({page})=>{
    const list=[];events.set(page,list);
    const push=item=>{if(list.length<30)list.push(item);};
    page.on('console',m=>{if(['error','warning'].includes(m.type()))push({type:m.type(),text:m.text().slice(0,350)});});
    page.on('pageerror',e=>push({type:'pageerror',text:e.message}));
    page.on('requestfailed',r=>{const u=new URL(r.url());push({type:'network',url:u.origin+u.pathname,error:r.failure()?.errorText});});
    page.on('response',r=>{if(r.status()>=400){const u=new URL(r.url());push({type:'http',url:u.origin+u.pathname,status:r.status()});}});
  });
  test.afterEach(async({page},info)=>{
    const state=await page.evaluate(()=>({operations:window.__firestoreOperations,appCheck:window.__appCheckEvents,busy:typeof playerApplyBusy==='undefined'?null:playerApplyBusy,save:typeof communitySettingsSaving==='undefined'?null:communitySettingsSaving,cloudError:window.__BXH_LAST_CLOUD_ERROR_CODE})).catch(()=>({closed:true}));
    const report={...state,events:events.get(page)||[]};
    console.log('FIRESTORE-DIAGNOSTICS',JSON.stringify(report));
    await info.attach('firestore-diagnostics',{body:JSON.stringify(report,null,2),contentType:'application/json'});
  });
};
