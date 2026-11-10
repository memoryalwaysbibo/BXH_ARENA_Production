'use strict';

const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {join}=require('node:path');
const {createBindings}=require('./registration-flow-v2/backend/bindings.cjs');
const {createManagementAuthorizer,createQueuedPromotion}=require('./registration-flow-v2/backend/management.cjs');
const {prepareRosterSource}=require('./registration-flow-v2/backend/prepare-roster.cjs');
const {createPromotionHandler,authorized}=require('./registration-promotion/functions/service.cjs');

const {createFamilyRegistration}=require('./writer-inputs/familyRegistration/family-registration.js');
const {guardFirestore}=require('./writer-inputs/familyRegistration/_qr_checkin/guard-firestore.cjs');
const family=Object.assign(
 (store,clock,options)=>createFamilyRegistration(guardFirestore(store),clock,options),
 {v2CapacityAware:createFamilyRegistration.v2CapacityAware},
);
const {rosterFactory,canCancel,canPromoteUnlimited}=prepareRosterSource(
 join(__dirname,'writer-inputs/registrationRosterService'),FieldValue,
);

initializeApp();
const db=getFirestore();
module.exports=createBindings({
 db,FieldValue,createFamilyRegistration:family,rosterFactory,stagedOnly:true,
 promotionFactory:createQueuedPromotion({
  roster:rosterFactory,
  promote:store=>createPromotionHandler(store,{allowUnseatedOfficial:true,timestamp:()=>FieldValue.serverTimestamp()}),
 }),
 authorizeManagement:createManagementAuthorizer({db,canCancel,canPromote:authorized,canPromoteUnlimited}),
});
