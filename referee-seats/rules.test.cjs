'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc}=require('firebase/firestore');
let env;
const full=fs.readFileSync(__dirname+'/firestore.candidate.rules','utf8'),a=full.indexOf('    function refereeSeatWriteValid('),b=full.indexOf('\n    // ==== 路徑輔助函式',a),helper=full.slice(a,b);
before(async()=>{
 // Compile the complete composed candidate, then exercise the exact added guard
 // independently so unrelated legacy QR/onsite fixture contracts cannot mask it.
 env=await initializeTestEnvironment({projectId:'demo-referee-seat-compile',firestore:{host:'127.0.0.1',port:8197,rules:full}});await env.cleanup();
 const rules=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
 function tourPath(code){return /databases/$(database)/documents/tournaments/$(code);}
 function isSignedIn(){return request.auth!=null;}
 function isAdminOrAbove(){return request.auth!=null && request.auth.token.admin==true;}
 function isStaffOfficialCreatorExistingData(room){return request.auth!=null&&room.createdBy==request.auth.uid;}
 ${helper}
 match /tournaments/{code}{allow read:if isSignedIn();allow update:if isSignedIn()&&refereeSeatWriteValid(code,true);}
 } }`;
 env=await initializeTestEnvironment({projectId:'demo-referee-seat-guard',firestore:{host:'127.0.0.1',port:8197,rules}});
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'tournaments/BXH-TEST'),{createdBy:'host',data:'old',refereeSeatsV1:{version:1},refereeSeatNames:{},refereeStationAssignments:{'1':['seated']},refereeStationNames:{'1':['A']},refereeStationUids:['seated'],refereeStationRestrictionEnabled:true}));
});
after(async()=>{await env?.cleanup();});
test('full candidate and actual seat guard compile',()=>{assert(helper.includes('function refereeSeatWriteValid'));});
test('even administrator cannot overwrite callable-owned seats or legacy projection directly',async()=>{const db=env.authenticatedContext('admin',{admin:true}).firestore();await assertFails(updateDoc(doc(db,'tournaments/BXH-TEST'),{refereeSeatsV1:{version:1,revision:999}}));await assertFails(updateDoc(doc(db,'tournaments/BXH-TEST'),{refereeStationAssignments:{'1':['intruder']}}));});
test('revoked staff cannot submit data; seated referee and host retain aggregate access',async()=>{await assertFails(updateDoc(doc(env.authenticatedContext('revoked',{admin:false}).firestore(),'tournaments/BXH-TEST'),{data:'tamper'}));await assertSucceeds(updateDoc(doc(env.authenticatedContext('seated',{admin:false}).firestore(),'tournaments/BXH-TEST'),{data:'score'}));await assertSucceeds(updateDoc(doc(env.authenticatedContext('host',{admin:false}).firestore(),'tournaments/BXH-TEST'),{data:'host'}));});
