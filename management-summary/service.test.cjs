'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createSummaryHandler,FIELDS,registrationStatus}=require('./functions/service.cjs');
const NOW=Date.parse('2026-10-30T03:00:00Z');
const profile={role:'super_admin',active:true};
const grant={status:'active',scope:'contract',organizationId:'org',orderCode:'order',startsAtMs:NOW-1000,expiresAtMs:NOW+10000};
const room=(code,extra={})=>({code,name:'賽事 '+code,eventDate:'2026-11-01',updatedAt:1,createdBy:'owner',createdByRole:'admin',eventAuthority:'official',registrationEnabled:true,registrationStatus:'open',publishedAt:1,...extra});
const rooms=n=>Array.from({length:n},(_,i)=>room('BXH-'+String(i).padStart(6,'0'),{eventDate:'2026-11-'+String(i+1).padStart(2,'0')}));
function fixture(user=profile,data=rooms(12),parents={}){
 const reads=[],selections=[],wheres=[];
 const db={doc:path=>({path}),collection:path=>{const q={path,filters:[],where(...args){wheres.push(args);this.filters.push(args);return this;},select(...fields){selections.push(fields);this.fields=fields;return this;}};return q;},runTransaction:(fn,options)=>{assert.equal(options?.readOnly,true,'summary reads must use a lock-free read-only snapshot');return fn({get:async ref=>{
  reads.push(ref);
  if(ref.path.startsWith('users/')){const uid=ref.path.slice(6),value=uid==='actor'?user:parents[uid];return{exists:!!value,data:()=>value};}
  assert.ok(ref.fields,'all tournament reads must have an explicit Firestore projection');
  assert.ok(!ref.fields.includes('data')&&!ref.fields.includes('bracketView'));
  const valueAt=(row,key)=>key.split('.').reduce((value,part)=>value?.[part],row);
  const selected=data.filter(row=>ref.filters.every(([key,op,value])=>valueAt(row,key)===value));
  return{docs:selected.map(row=>({id:row.code,data:()=>{
   const projected={};for(const key of ref.fields){const value=valueAt(row,key);if(value===undefined)continue;
    const parts=key.split('.');let target=projected;for(const part of parts.slice(0,-1))target=target[part]||=( {} );target[parts.at(-1)]=value;
   }return projected;
  }}))};
 }});}};
 const list=createSummaryHandler(db,{now:()=>NOW});
 return{reads,selections,wheres,call:(data={})=>list({auth:{uid:'actor'},data}),list};
}
test('Firestore projection returns five summaries and pagination never returns full runtime or registrations',async()=>{
 const data=rooms(12);data[11].data='sensitive full runtime';data[11].bracketView='sensitive bracket';data[11].players=[{email:'hidden'}];
 const t=fixture(profile,data),first=await t.call();
 assert.equal(first.items.length,5);assert.equal(first.counts.open,12);assert.equal(first.hasMore,true);
 assert.equal(first.items[0].eventDate,'2026-11-12');
 assert.equal(t.selections.length,1);assert.deepEqual(t.selections[0],FIELDS);
 assert.ok(!JSON.stringify(first).includes('sensitive'));assert.ok(!JSON.stringify(first).includes('hidden'));
 const second=await t.call({cursor:first.nextCursor}),third=await t.call({cursor:second.nextCursor});
 assert.equal(second.items.length,5);assert.equal(third.items.length,2);assert.equal(third.hasMore,false);
 assert.equal(new Set([...first.items,...second.items,...third.items].map(row=>row.code)).size,12);
});
test('search finds names, room codes and locations beyond the first page without leaking unmatched rows',async()=>{
 const data=rooms(12);data[0].name='很早的雪山貓賽事';data[1].location='台南南區';
 const t=fixture(profile,data);
 for(const [search,name]of [['雪山貓',data[0].name],['bxh-000000',data[0].name],['南區',data[1].name]]){
  const result=await t.call({search});assert.equal(result.items.length,1);assert.equal(result.items[0].name,name);assert.equal(result.counts.all,1);
 }
});
test('state tabs classify full as open, future as upcoming and archived or cancelled as closed',async()=>{
 const data=[room('OPEN'),room('FULL',{registrationStatus:'full',capacity:32,confirmedCount:32}),room('FUTURE',{registrationStatus:'scheduled',registrationOpenAt:NOW+1000}),room('PAST',{registrationCloseAt:NOW-1000}),room('ARCHIVE',{archiveStatus:'completed'}),room('CANCELLED',{eventCancelled:true}),room('DRAFT',{registrationStatus:'draft',registrationEnabled:false})];
 const t=fixture(profile,data);const first=await t.call();assert.deepEqual(first.counts,{all:7,open:2,upcoming:1,closed:3,draft:1});
 assert.equal((await t.call({status:'upcoming'})).items[0].code,'FUTURE');assert.equal((await t.call({status:'draft'})).items[0].code,'DRAFT');
 assert.equal(registrationStatus({registrationStatus:'scheduled',registrationEnabled:true,registrationOpenAt:NOW-1,publishedAt:1},NOW),'open');
});
test('cursor is bound to actor, authorization scope, search, status and room type',async()=>{
 const t=fixture(),first=await t.call();for(const extra of [{search:'別的'},{status:'closed'},{kind:'community'}])await assert.rejects(t.call({...extra,cursor:first.nextCursor}),/invalid-cursor/);
 await assert.rejects(t.call({cursor:'broken'}),/invalid-cursor/);
});
test('deleted cursor anchor does not skip the next remaining room',async()=>{
 const data=rooms(12),t=fixture(profile,data),first=await t.call();const anchor=first.items.at(-1).code;
 data.splice(data.findIndex(row=>row.code===anchor),1);const second=await t.call({cursor:first.nextCursor});assert.equal(second.items.length,5);assert.ok(!second.items.some(item=>first.items.some(old=>old.code===item.code)));
});
test('only administrators can list general community rooms; staff retain formal event visibility',async()=>{
 const data=[room('OFFICIAL'),room('COMMUNITY',{eventAuthority:'community'})];
 assert.deepEqual((await fixture(profile,data).call({kind:'community'})).items.map(row=>row.code),['COMMUNITY']);
 const t=fixture({role:'staff',active:true},data);await assert.rejects(t.call({kind:'community'}),/permission-denied/);assert.equal((await t.call()).items.length,1);
});
test('ordinary, disabled, deleted, frozen and inactive accounts cannot read summaries',async()=>{
 for(const user of [{role:'player',active:true},{role:'admin',active:false},{role:'admin',active:true,deleted:true},{role:'admin',active:true,accountStatus:'frozen'}]){
  const t=fixture(user);await assert.rejects(t.call(),/permission-denied/);assert.equal(t.selections.length,0);
 }
 await assert.rejects(fixture().list({data:{}}),/unauthenticated/);
});
test('tester accounts only see their own marked test rooms, including test-flagged admin accounts',async()=>{
 const data=[room('OWN',{eventAuthority:'test',createdBy:'actor',testMode:true}),room('FOREIGN',{eventAuthority:'test',createdBy:'other',testMode:true}),room('UNMARKED',{eventAuthority:'test',createdBy:'actor'}),room('OFFICIAL')];
 for(const user of [{role:'tester',active:true},{role:'admin',active:true,isTestAccount:true}])assert.deepEqual((await fixture(user,data).call()).items.map(row=>row.code),['OWN']);
});
test('partner organizer scope is limited to the live owner, organization and contract',async()=>{
 const user={role:'player',active:true,partnerOrganizer:grant};
 const data=[room('OWN',{createdBy:'actor',createdByRole:'partner_organizer',partnerOrganizationCode:'org',partnerContractOrderCode:'order'}),room('BXH'),room('OTHER',{createdBy:'other',createdByRole:'partner_organizer',partnerOrganizationCode:'org',partnerContractOrderCode:'order'}),room('OLD',{createdBy:'actor',createdByRole:'partner_organizer',partnerOrganizationCode:'org',partnerContractOrderCode:'old'})];
 const t=fixture(user,data);assert.deepEqual((await t.call({mode:'partner_organizer'})).items.map(row=>row.code),['OWN']);
 for(const patch of [{expiresAtMs:NOW},{startsAtMs:NOW+1},{orderCode:null},{status:'revoked'}])await assert.rejects(fixture({...user,partnerOrganizer:{...grant,...patch}},data).call({mode:'partner_organizer'}),/permission-denied/);
});
test('event staff require accepted assignment and a still-effective parent organizer authorization',async()=>{
 const user={role:'player',active:true};const parent={role:'player',active:true,partnerOrganizer:grant};
 const assignment={targetUid:'actor',organizerUid:'owner',organizationId:'org',parentFingerprint:'contract:order',status:'accepted'};
 const data=[room('EVENT',{createdByRole:'partner_organizer',partnerOrganizationCode:'org',partnerContractOrderCode:'order',eventStaffAssignments:{actor:assignment}}),room('UNINVITED')];
 const t=fixture(user,data,{owner:parent});assert.equal((await t.call({mode:'event_staff'})).items.length,1);
 assert.ok(t.selections[0].includes('eventStaffAssignments.actor'));assert.ok(!JSON.stringify(await t.call({mode:'event_staff'})).includes('parentFingerprint'));
 parent.partnerOrganizer={...grant,status:'revoked'};assert.equal((await t.call({mode:'event_staff'})).items.length,0);
});
test('invalid inputs fail before any database query',async()=>{
 const t=fixture();for(const data of [{status:'mine'},{kind:'private'},{mode:'super_admin'},{search:'x'.repeat(121)},{cursor:123}])await assert.rejects(t.call(data),/invalid-/);assert.equal(t.reads.length,0);
});
