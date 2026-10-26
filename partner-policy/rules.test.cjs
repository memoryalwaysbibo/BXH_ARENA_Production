'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):8184$/,'local emulator required');
const project='demo-bxh-partner-rules';assert.ok(!process.env.GCLOUD_PROJECT||process.env.GCLOUD_PROJECT===project,'production project forbidden');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDocFromServer:getDoc,setDoc,updateDoc,writeBatch}=require('firebase/firestore');
let env;after(async()=>{if(env)await env.cleanup();});
async function fixture(policy='start-v1'){
 if(!env)env=await initializeTestEnvironment({projectId:project,firestore:{host:'127.0.0.1',port:8184,rules:fs.readFileSync(path.join(__dirname,'firestore.candidate.rules'),'utf8')}});
 const tag=randomBytes(5).toString('hex').toUpperCase(),owner='owner-'+tag,code='BXH-'+tag,order='BXH-CO-20261027-'+tag+'AA',now=Date.now();
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await Promise.all([setDoc(doc(db,'users',owner),{role:'player',active:true,isTestAccount:false,partnerContractOrderCode:order,partnerOrganizer:{status:'active',scope:'contract',organizationId:'org',orderCode:order,quotaPolicy:policy,quotaPolicyVersion:1,startsAtMs:now-86400000,expiresAtMs:now+86400000}}),setDoc(doc(db,'users','admin'),{role:'super_admin',active:true}),setDoc(doc(db,'partnerContracts',order),{status:'active',targetUid:owner,organizationCode:'org',quotaPolicy:policy,quotaPolicyVersion:1,includedEvents:1,usedEvents:0,lastRoomCode:''})]);});
 const db=env.authenticatedContext(owner).firestore(),fields=policy==='start-v1'?{partnerQuotaPolicy:'start-v1',partnerStartState:'draft'}:{};
 const room={eventAuthority:'official',createdBy:owner,createdByRole:'partner_organizer',partnerOrganizationCode:'org',partnerContractOrderCode:order,assignedStaffUids:[owner],visibility:'public',ladderPointsAwarded:false,ladderMode:'ranked',data:'{"startedAt":null}',...fields};
 const pub={eventAuthority:'official',bracketView:'{"startedAt":null}',visibility:'public',updatedAt:now,confirmedCount:0,waitlistCount:0,ladderMode:'ranked',...fields};
 const commit=({charge=false,privatePatch={},publicPatch={},noPublic=false}={})=>{const b=writeBatch(db);b.set(doc(db,'tournaments',code),{...room,...privatePatch});if(!noPublic)b.set(doc(db,'publicTournaments',code),{...pub,...publicPatch});if(charge)b.update(doc(db,'partnerContracts',order),{usedEvents:1,lastRoomCode:code});return b.commit();};
 return {db,code,order,owner,commit};
}
test('new policy creates both draft mirrors with zero quota consumption',async()=>{
 const f=await fixture();await assertSucceeds(f.commit());await env.withSecurityRulesDisabled(async c=>assert.equal((await getDoc(doc(c.firestore(),'partnerContracts',f.order))).data().usedEvents,0));
});
test('legacy policy still requires creation-time debit',async()=>{
 const f=await fixture('creation-v1');await assertFails(f.commit());await assertSucceeds(f.commit({charge:true}));
});
test('old clients cannot charge a new-policy contract or omit its policy markers',async()=>{
 for(const change of [{charge:true},{charge:true,privatePatch:{partnerQuotaPolicy:'creation-v1'}},{privatePatch:{partnerQuotaPolicy:'creation-v1'}}]){const f=await fixture();await assertFails(f.commit(change));}
});
test('new-policy creation requires a paired public draft and refuses fake start evidence',async()=>{
 for(const change of [{privatePatch:{ladderMode:'general'}},{noPublic:true},{publicPatch:{partnerStartState:'started'}},{privatePatch:{partnerStartedAt:123}},{privatePatch:{partnerQuotaDebit:{source:'server'}}}]){const f=await fixture();await assertFails(f.commit(change));}
});
test('legacy and unknown contracts cannot self-select the new policy',async()=>{
 const f=await fixture('creation-v1');await assertFails(f.commit({privatePatch:{partnerQuotaPolicy:'start-v1',partnerStartState:'draft'},publicPatch:{partnerQuotaPolicy:'start-v1',partnerStartState:'draft'}}));const unknown=await fixture('unknown');await assertFails(unknown.commit({charge:true}));
});
test('owner and administrator cannot forge protected start/receipt/policy fields',async()=>{
 const f=await fixture();await assertSucceeds(f.commit());for(const uid of [f.owner,'admin']){const db=env.authenticatedContext(uid).firestore();for(const patch of [{partnerStartState:'started'},{partnerQuotaPolicy:'creation-v1'},{partnerStartedAt:123},{partnerQuotaDebit:{source:'server'}},{rdwSnapshotDigest:'a'.repeat(64)}])await assertFails(updateDoc(doc(db,'tournaments',f.code),patch));await assertFails(setDoc(doc(db,'partnerEventDebits',f.code),{source:'server'}));await assertFails(updateDoc(doc(db,'publicTournaments',f.code),{partnerStartState:'started'}));}
});
