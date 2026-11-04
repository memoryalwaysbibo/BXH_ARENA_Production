'use strict';
function createAdminBridge(db){
 if(!db||typeof db.runTransaction!=='function')throw Error('firestore-required');
 return {doc:p=>db.doc(p),collection:p=>db.collection(p),collectionGroup:p=>db.collectionGroup(p),async run(label,callback,{readOnly=false}={}){return {value:await db.runTransaction(callback,readOnly?{readOnly:true}:{maxAttempts:5})};}};
}
function shouldContinueJob(event){
 const after=event?.data?.after,before=event?.data?.before;if(!after?.exists)return false;
 const a=after.data(),b=before?.exists?before.data():null;
 return a?.schemaVersion===24&&a.release==='individual-family-v24'&&a.dirty===true&&(!b||b.revision!==a.revision||b.cursor!==a.cursor);
}
function shouldProcessOperation(event,now){
 const after=event?.data?.after,before=event?.data?.before;if(!after?.exists||!Number.isSafeInteger(now))return false;
 const a=after.data(),b=before?.exists?before.data():null,s=a?.membershipSync,old=b?.membershipSync;
 return a?.myEventsProof?.schemaVersion===25&&s?.schemaVersion===25&&s.state==='pending'&&s.pending===true&&Number.isSafeInteger(s.dueAt)&&s.dueAt<=now&&(!old||old.state!=='pending'||old.dueAt!==s.dueAt||old.proofFingerprint!==s.proofFingerprint);
}
function createService({db,documentId,onCall,onDocumentWritten,onSchedule,enabled=false,clock=Date.now,factories={}}={}){
 if(![onCall,onDocumentWritten,onSchedule].every(f=>typeof f==='function'))throw Error('functions-v2-factories-required');
 const createEngine=factories.createEngine||require('./engine.cjs').createEngine;
 const {createRebuilder,shouldProcessRebuild}=factories.rebuild||require('./rebuild.cjs');
 const {createBootstrap,shouldProcessBootstrap}=factories.bootstrap||require('./bootstrap.cjs');
 const createOperationProcessor=factories.createOperationProcessor||require('./operation-processor.cjs').createOperationProcessor;
 const createAuthenticatedReader=factories.createAuthenticatedReader||require('../reader/auth-reader.cjs').createAuthenticatedReader;
 const status=factories.status||require('../reader/operation-status.cjs');
 const bridge=enabled===true?createAdminBridge(db):undefined;
 if(enabled===true&&!documentId)throw Error('sdk-document-id-field-required');
 const engine=createEngine({enabled,bridge,clock,documentId});
 const rebuilder=createRebuilder({enabled,bridge,engine,clock,documentId});
 const bootstrap=createBootstrap({enabled,bridge,rebuilder,clock,documentId});
 const processor=createOperationProcessor({enabled,bridge,engine,clock});
 const verifyAuth=async request=>request.auth?.uid?{uid:request.auth.uid}:null;
 const reader=createAuthenticatedReader({enabled,bridge,documentId,verifyAuth});
 const options={enabled,bridge,verifyAuth,processor};
 const region='asia-east1';
 const processOperation=event=>enabled===true&&shouldProcessOperation(event,clock())?processor.processOperation(event.data.after.ref.path):Promise.resolve({status:'ignored'});
 return Object.freeze({
  queryMyActiveEvents:onCall({region,timeoutSeconds:30,maxInstances:2},reader),
  queryMyEventOperationStatus:onCall({region,timeoutSeconds:30,maxInstances:2},status.createOperationStatusReader(options)),
  retryMyEventOperationSync:onCall({region,timeoutSeconds:30,maxInstances:2},status.createAuthenticatedOperationRetry(options)),
  myEventsRegistrationChanged:onDocumentWritten({region,document:'tournaments/{code}/registrations/{id}',retry:true,timeoutSeconds:120,maxInstances:4},event=>engine.ingestRegistration({code:event.params.code,id:event.params.id})),
  myEventsRoomChanged:onDocumentWritten({region,document:'tournaments/{code}',retry:true,timeoutSeconds:120,maxInstances:2},async event=>{const result=await engine.recordRoom({code:event.params.code});await bootstrap.captureRoom({code:event.params.code});return result;}),
  myEventsMembershipPage:onDocumentWritten({region,document:'myEventRoomJobs/{code}',retry:true,timeoutSeconds:120,maxInstances:4},event=>enabled===true&&shouldContinueJob(event)?engine.processPage(event.params.code):Promise.resolve({status:'ignored'})),
  myEventsFamilyOperationChanged:onDocumentWritten({region,document:'familyPlayers/{uid}/registrationActions/{actionId}',retry:true,timeoutSeconds:120,maxInstances:4},processOperation),
  myEventsRosterOperationChanged:onDocumentWritten({region,document:'tournaments/{code}/rosterActions/{actionId}',retry:true,timeoutSeconds:120,maxInstances:4},processOperation),
  myEventsRebuildPage:onDocumentWritten({region,document:'myEventRebuildsV26/{code}',retry:true,timeoutSeconds:120,maxInstances:4},event=>enabled===true&&shouldProcessRebuild(event,clock())?rebuilder.processPage(event.params.code):Promise.resolve({status:'ignored'})),
  myEventsBootstrapPage:onDocumentWritten({region,document:'myEventBootstrapRunsV26/{runId}',retry:true,timeoutSeconds:120,maxInstances:1},event=>enabled===true&&shouldProcessBootstrap(event,clock())?bootstrap.processPage(event.params.runId):Promise.resolve({status:'ignored'})),
  myEventsMembershipRepair:onSchedule({region,schedule:'every 1 minutes',timeoutSeconds:120,maxInstances:1},()=>engine.repair()),
  myEventsOperationRepair:onSchedule({region,schedule:'every 1 minutes',timeoutSeconds:120,maxInstances:1},()=>processor.repair()),
  myEventsMaintenanceRepair:onSchedule({region,schedule:'every 1 minutes',timeoutSeconds:180,maxInstances:1},async()=>({rebuild:await rebuilder.repair(),bootstrap:await bootstrap.repair()}))
 });
}
module.exports={createService,createAdminBridge,shouldContinueJob,shouldProcessOperation};
