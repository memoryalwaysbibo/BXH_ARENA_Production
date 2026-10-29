'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {activeStaff,projectStaffRoster,createStaffRosterHandler}=require('./functions/staff-roster-service.cjs');
const room=(state={},extra={})=>({eventAuthority:'official',assignedStaffUids:['someone-else'],data:JSON.stringify({meta:{checkinRequired:true},players:[],waitlistPlayers:[],...state}),...extra});
function harness(user={role:'staff',active:true},event=room(),registrations=[]){
 const reads=[],records=new Map([['users/staff',user],['tournaments/BXH-EKPRMZ',event]]);
 const db={doc:path=>path,collection:path=>path,runTransaction:fn=>fn({get:async path=>{
  reads.push(path);
  if(path.endsWith('/registrations'))return {docs:registrations.map((data,index)=>({id:'r'+index,data:()=>data}))};
  return {exists:records.has(path),data:()=>records.get(path)};
 }})};
 return {read:createStaffRosterHandler(db),reads,request:{auth:{uid:'staff'},data:{code:' bxh-ekprmz '}}};
}
test('formal staff can read even when another staff member is assigned, with no write methods available',async()=>{
 const h=harness(undefined,undefined,[{status:'confirmed',publicName:'選手甲',phone:'SECRET',email:'SECRET',uid:'SECRET'}]);
 const result=await h.read(h.request);
 assert.deepEqual(result,{ok:true,code:'BXH-EKPRMZ',rows:[{name:'選手甲',status:'confirmed',source:'online',checkedIn:false}]});
 assert(!JSON.stringify(result).includes('SECRET'));
});
test('rejects guest, player, inactive, test, deleted and frozen identities before reading registrations',async()=>{
 for(const user of [{role:'player',active:true},{role:'staff',active:false},{role:'staff',active:true,isTestAccount:true},
  {role:'staff',active:true,deleted:true},{role:'staff',active:true,accountStatus:'frozen'}]){
  const h=harness(user);await assert.rejects(()=>h.read(h.request),/permission-denied/);
  assert(!h.reads.some(path=>path.endsWith('/registrations')));
 }
 const h=harness();await assert.rejects(()=>h.read({data:{code:'BXH-EKPRMZ'}}),/unauthenticated/);
 await assert.rejects(()=>h.read({...h.request,data:{code:'../bad'}}),/invalid-code/);
});
test('rejects community, test, and missing rooms',async()=>{
 for(const extra of [{eventAuthority:'community'},{testMode:true},{createdByRole:'tester'}]){
  const h=harness(undefined,room({},extra));await assert.rejects(()=>h.read(h.request),/permission-denied/);
 }
 const h=harness();await assert.rejects(()=>h.read({...h.request,data:{code:'BXH-MISSING'}}),/not-found/);
});
test('family players, team members, local players, cancellations and check-in remain distinct',()=>{
 const event=room({players:[{name:'現場甲',source:'onsite',checkedIn:true},
  {name:'舊名',source:'online',registrationId:'family-r',checkedIn:true}]});
 const rows=projectStaffRoster(event,[{registrationId:'family-r',familyPlayerId:'child-secret',publicName:'孩子甲',status:'confirmed'},
  {registrationId:'team-r',registrationKind:'team',teamMembers:[{name:'隊員甲',slot:1},{name:'隊員乙',slot:2}],status:'waitlist'},
  {registrationId:'cancel-r',publicName:'已取消',status:'cancelled'}]);
 assert.deepEqual(rows.map(row=>row.name),['現場甲','孩子甲','隊員甲','隊員乙']);
 assert.equal(rows[1].checkedIn,true);assert.equal(rows[2].status,'waitlist');
 assert(!JSON.stringify(rows).includes('child-secret'));
});
test('drawn, played, onsite and selection rosters use the authoritative participants',()=>{
 for(const state of [{bracketSize:64},{startedAt:123},{matches:[{id:'m'}]},
  {entrySelection:{status:'drawn'}},{meta:{registrationOnsiteWaitlistEnabled:true}}]){
  const result=projectStaffRoster(room({...state,players:[{name:'實際正取',checkedIn:true}],waitlistPlayers:[{name:'實際備取'}]}),
   [{registrationId:'r',publicName:'不得重排',status:'confirmed'}]);
  assert.deepEqual(result.map(row=>row.name),['實際正取','實際備取']);
 }
});
