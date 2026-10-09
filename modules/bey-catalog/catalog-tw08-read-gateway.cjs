'use strict';
/**
 * TW-08: server-side read-only query CONTRACT. This is not an HTTP endpoint.
 * Dependencies must be injected by a trusted backend, not from client payloads.
 * No Firestore SDK, write, approval, publication or production deployment.
 */
const {buildTw06ReviewQueue}=require('./catalog-tw06-review-queue.cjs');
const {createReviewMobileModel}=require('./catalog-tw07-mobile-model.cjs');
const {digest}=require('./catalog-tw06-review.cjs');
const FILTERS=new Set(['all','P0','P1','P2']);
const UID=/^[A-Za-z0-9_-]{2,128}$/;
function requireAdapter(adapter){
 if(!adapter||typeof adapter.verifyIdToken!=='function'||
    typeof adapter.loadUserByUid!=='function'||
    typeof adapter.loadResearchBatch!=='function')throw Error('TW08_TRUSTED_BACKEND_ADAPTER_REQUIRED');
}
function parseRequest(request={}){
 if(!request||typeof request!=='object'||Array.isArray(request))throw Error('TW08_REQUEST_INVALID');
 const {filter='all',query='',limit=10,cursor=null}=request;
 if(!FILTERS.has(filter)||typeof query!=='string'||query.length>80||
    !Number.isSafeInteger(limit)||limit<1||limit>20||
    (cursor!==null&&(typeof cursor!=='string'||cursor.length>120)))throw Error('TW08_REQUEST_INVALID');
 return {filter,query:query.trim(),limit,cursor};
}
function decodeCursor(cursor,expectedFingerprint){
 if(cursor===null)return 0;
 const match=/^tw08:([a-f0-9]{20}):(0|[1-9]\d{0,5})$/.exec(cursor);
 if(!match||match[1]!==expectedFingerprint)throw Error('TW08_STALE_OR_INVALID_CURSOR');
 const offset=Number(match[2]);
 if(!Number.isSafeInteger(offset))throw Error('TW08_STALE_OR_INVALID_CURSOR');
 return offset;
}
function deny(){return {access:'denied',readOnly:true,canApprove:false,canPublish:false,items:[],summary:null,nextCursor:null};}
async function readTaiwanReviewQueue({adapter,idToken,request}={}){
 requireAdapter(adapter);
 const params=parseRequest(request);
 if(typeof idToken!=='string'||!idToken||idToken.length>8192)throw Error('TW08_ID_TOKEN_REQUIRED');
 // Production integration MUST use Firebase Admin verifyIdToken(idToken, true)
 // and trusted Firestore user records. Never trust a client-supplied role.
 const decoded=await adapter.verifyIdToken(idToken,true);
 if(!UID.test(decoded?.uid||'')||decoded?.firebase?.sign_in_provider==='anonymous')return deny();
 const profile=await adapter.loadUserByUid(decoded.uid);
 if(!profile||profile.active!==true||profile.isTestAccount===true||
    !['admin','super_admin'].includes(profile.role))return deny();
 // Read batch only after authorization. Do not accept client-provided dataset.
 const batch=await adapter.loadResearchBatch();
 const queue=buildTw06ReviewQueue(batch);
 const view=createReviewMobileModel(queue,{viewerRole:profile.role,filter:params.filter,query:params.query});
 const fingerprint=digest({batchId:queue.batchId,queueVersion:queue.queueVersion,items:view.visibleItems,filter:params.filter,query:params.query}).slice(0,20);
 const offset=decodeCursor(params.cursor,fingerprint);
 if(offset>view.visibleItems.length)throw Error('TW08_CURSOR_OUT_OF_RANGE');
 const items=view.visibleItems.slice(offset,offset+params.limit).map(item=>Object.freeze({...item}));
 const nextOffset=offset+items.length;
 return {
  access:'preview',readOnly:true,canApprove:false,canPublish:false,
  sourceBatchId:queue.batchId,queueVersion:queue.queueVersion,
  summary:{...view.summary},items,
  nextCursor:nextOffset<view.visibleItems.length?`tw08:${fingerprint}:${nextOffset}`:null,
  pageSize:items.length
 };
}
module.exports={readTaiwanReviewQueue,parseRequest};
