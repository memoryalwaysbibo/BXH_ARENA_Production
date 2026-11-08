'use strict';
const {createService,createAdminBridge}=require('./vendor/backend/service.cjs');
const DEFAULT_FLAGS=Object.freeze({reads:false,capture:false,repair:false,backfill:false,retry:false});
const CAPTURE=['myEventsRegistrationChanged','myEventsRoomChanged','myEventsMembershipPage','myEventsFamilyOperationChanged','myEventsRosterOperationChanged'];
const BACKFILL=['myEventsRebuildPage','myEventsBootstrapPage'];
const REPAIR=['myEventsMembershipRepair','myEventsOperationRepair'];
function validateFlags(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_FLAGS,k)||typeof input[k]!=='boolean'))throw Error('invalid-flags');
 const f={...DEFAULT_FLAGS,...input};
 if((f.repair||f.backfill||f.retry)&&!f.capture)throw Error('capture-required');
 if(f.retry&&!f.reads)throw Error('reads-required');
 return Object.freeze(f);
}
function assemble({flags={},db,documentId,sdk,clock=Date.now}={}){
 const f=validateFlags(flags);
 if(!Object.values(f).some(Boolean))return Object.freeze({});
 if(!db||!documentId)throw Error('admin-sdk-required');
 if(!sdk||!['onCall','onDocumentWritten','onSchedule'].every(k=>typeof sdk[k]==='function'))throw Error('functions-sdk-required');
 const descriptor=kind=>(options,handler)=>({kind,options,handler});
 // Pure construction only: the unchanged v26 factory does not invoke handlers.
 const definitions=createService({enabled:f.capture,db,documentId,clock,
  onCall:descriptor('onCall'),onDocumentWritten:descriptor('onDocumentWritten'),onSchedule:descriptor('onSchedule')});
 const selected={};
 for(const name of [...(f.capture?CAPTURE:[]),...(f.backfill?BACKFILL:[]),...(f.repair?REPAIR:[]),...(f.repair&&f.backfill?['myEventsMaintenanceRepair']:[]),...(f.retry?['retryMyEventOperationSync']:[])])selected[name]=definitions[name];
 if(f.reads){
  const bridge=createAdminBridge(db);
  // Only Firebase callable verified context; never request.data.uid or headers.
  const verifyAuth=async request=>request?.auth?.uid?{uid:request.auth.uid}:null;
  const common={enabled:true,bridge,verifyAuth,documentId};
  const onRead=handler=>({kind:'onCall',options:{region:'asia-east1',timeoutSeconds:30,maxInstances:2},handler});
  selected.queryMyActiveEvents=onRead(require('./vendor/reader/auth-reader.cjs').createAuthenticatedReader(common));
  selected.queryMyActiveEventDetails=onRead(require('./vendor/details/detail-reader.cjs').createDetailReader(common));
  selected.queryMyEventOperationStatus=onRead(require('./vendor/reader/operation-status.cjs').createOperationStatusReader(common));
 }
 const exported={};
 for(const [name,d] of Object.entries(selected))exported[name]=sdk[d.kind](d.options,d.handler);
 return Object.freeze(exported);
}
module.exports={assemble,validateFlags,DEFAULT_FLAGS};
