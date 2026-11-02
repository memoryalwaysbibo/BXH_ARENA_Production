'use strict';
// Exact formal cloud-runtime methods in an isolated SDK harness. No production
// initialization/config is executed; the caller supplies only Emulator handles.
function build(cloud,core){
 const from=cloud.indexOf('  let fourCourtLifecycle = null;'),to=cloud.indexOf('  window.cloudSync = {',from);if(from<0||to<from)throw Error('cloud-route-helper-missing');
 function method(start,end){const a=cloud.indexOf(start),b=cloud.indexOf(end,a);if(a<0||b<a)throw Error('cloud-route-method-missing');return cloud.slice(a,b).trim();}
 const join=method('    async joinRoom(code){','    // Guest/public use — reads');
 const commands=method('    async commitRefereeCommand(data){','    async mutateMatchTransaction(');
 const subscribe=method('    subscribe(code, callback){','    // Guest/public use — subscribes');
 const a=core.indexOf("window.addEventListener('bxh-four-court-status'"),b=core.indexOf('let cloudJoinModalOpen',a);if(a<0||b<a)throw Error('core-status-handler-missing');
 const retryFrom=core.indexOf('let refereeBucketRetryBusy=false;'),retryTo=core.indexOf('async function performRefereeSyncRecovery(',retryFrom);if(retryFrom<0||retryTo<retryFrom)throw Error('core-retry-controls-missing');
 return `window.installBucketCloudRoute=function({auth,db,sdk,functions,enabled=true}){\nconst FOUR_COURT_CLIENT_ROLLOUT=enabled,cloudEnabled=true,authReady=true,authHandle=auth,dbHandle=db,ax=sdk,fx=sdk,functionsHandle=functions,fnx=sdk;\nconst ensureHunterClashAppCheck=async()=>{};\n${cloud.slice(from,to)}\nwindow.cloudSync={${join}\n${commands}\n${subscribe}};return window.cloudSync;};\nwindow.installBucketMainStatus=function(){${core.slice(a,b)}};\nwindow.installBucketRetryControls=function(){${core.slice(retryFrom,retryTo)};window.retryRefereeBucketOperations=retryRefereeBucketOperations;window.refereeSyncRecoveryControlsHtml=refereeSyncRecoveryControlsHtml;window.requestRefereeSyncRecovery=requestRefereeSyncRecovery;};`;
}
module.exports={build};
