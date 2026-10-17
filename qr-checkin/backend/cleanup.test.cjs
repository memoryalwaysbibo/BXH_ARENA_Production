'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assessRoom}=require('./overlays/cleanup/community-cleanup-policy.js');
const now=1800000000000;
const room=()=>({eventAuthority:'community',updatedAt:now-3*86400000,data:JSON.stringify({players:[{id:'p1'}],matches:[],meta:{eventAuthority:'community'}})});
test('automatic cleanup retains QR receipts even when an otherwise identical room is due',()=>{
 assert.equal(assessRoom(room(),now).status,'due');
 assert.equal(assessRoom({...room(),qrCheckinManaged:true},now).status,'qr-checkin-records-retained');
});
test('QR audit retention also protects a corrupt serialized roster from automatic removal',()=>{
 assert.equal(assessRoom({...room(),qrCheckinManaged:true,data:'broken'},now).status,'qr-checkin-records-retained');
 assert.equal(assessRoom({...room(),data:'broken'},now).status,'invalid-state');
});
