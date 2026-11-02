const vm=require('node:vm');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','modules','main-app','core.js'),'utf8');
const extract=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)+a.length));
async function run(){
 let calls=0;
 const ctx={staffRosterReadOnly:()=>true,renderStaffRegistrationRoster:()=>{calls++;return 'readonly';}};
 vm.createContext(ctx);
 vm.runInContext(extract('function renderAdminRegistrationsTab(){','function ',).replace(/async\s*$/, ''),ctx);
 assert.equal(ctx.renderAdminRegistrationsTab(),'readonly');assert.equal(calls,1);
 const load=extract('async function loadStaffRegistrationRoster(){','function renderStaffRegistrationRoster(){');
 for(const tab of ['people','registrations']){
  let renders=0,reads=0;
  const c={staffRosterReadOnly:()=>true,peopleRosterBusy:false,state:{cloudCode:'BXH-TEST'},captureRegistrationRosterContext:()=>({key:'a',generation:2,code:'BXH-TEST'}),registrationRosterContextKey:()=> 'a',adminRosterGeneration:2,appPhase:'app',registrationRosterViewTab:()=>tab,render:()=>renders++,showToast:()=>{},adminRegistrationsError:null,staffRosterCache:null,window:{cloudSync:{readStaffRegistrationRoster:async()=>{reads++;return {ok:true,code:'BXH-TEST',rows:[{name:'小寶',status:'confirmed'}]};}}}};
  vm.createContext(c);vm.runInContext(load,c);await c.loadStaffRegistrationRoster();
  assert.equal(reads,1);assert.equal(c.staffRosterCache.rows.length,1);assert.equal(c.peopleRosterBusy,false);assert.equal(renders,2);
  c.window.cloudSync.readStaffRegistrationRoster=async()=>{throw Error('permission-denied');};
  await c.loadStaffRegistrationRoster();assert.match(c.adminRegistrationsError,/無法讀取/);assert.equal(c.peopleRosterBusy,false);
  c.window.cloudSync.readStaffRegistrationRoster=async()=>{c.registrationRosterContextKey=()=> 'other';return {ok:true,code:'BXH-TEST',rows:[]};};
  await c.loadStaffRegistrationRoster();assert.equal(c.staffRosterCache.rows.length,1);
 }
 console.log('PASS: registration tab routes to readonly; both tabs load, show errors, release busy state and reject stale replies');
}
run().catch(e=>{console.error(e);process.exit(1);});
