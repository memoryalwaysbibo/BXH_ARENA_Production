const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
function extract(start,end){
  const from=core.indexOf(`function ${start}(`);
  const to=core.indexOf(`function ${end}(`,from);
  assert.ok(from>=0&&to>from);
  return core.slice(from,to);
}

test('ticket rooms never select or load the BXH template, including existing snapshots',()=>{
  const context={userProfile:{active:true,role:'super_admin'},state:{meta:{eventAuthority:'ticket'},eventInfo:{standardTemplate:{enabled:true,templateId:'bxh-standard',snapshot:{version:'v1.3'}}}},isPartnerOrganizerMode:()=>true,
    emptyEventInfoV2:()=>({standardTemplate:{enabled:false}}),normalizeEventInfoV2:x=>x};
  vm.createContext(context);
  vm.runInContext(extract('canUseBxhStandardTemplate','bxhTemplateSnapshot'),context);
  assert.equal(vm.runInContext('canUseBxhStandardTemplate()',context),false);
  assert.equal(vm.runInContext('roomStandardTemplateSelected()',context),false);
  context.state={meta:{eventAuthority:'official'},eventInfo:{standardTemplate:{enabled:true,templateId:'bxh-standard',snapshot:{version:'v1.3'}}}};
  assert.equal(vm.runInContext('canUseBxhStandardTemplate()',context),true);
  assert.equal(vm.runInContext('roomStandardTemplateSelected()',context),true);
});

test('ticket room detail hides a legacy BXH template snapshot while official detail keeps it',()=>{
  const context={esc:String};vm.createContext(context);
  vm.runInContext(extract('renderTournamentStandardTemplate','renderTeamRegistrationAction'),context);
  const snapshot={enabled:true,versionLabel:'v1.3',snapshot:{rules:'規則',notices:'注意',legalPositioning:'定位'}};
  const room={code:'PTN-40AF0A',eventAuthority:'ticket',parsedData:{meta:{eventAuthority:'ticket'},eventInfo:{standardTemplate:snapshot}}};
  assert.equal(context.renderTournamentStandardTemplate(room),'');
  room.code='BXH-ABCDE';room.eventAuthority='official';room.parsedData.meta.eventAuthority='official';
  assert.match(context.renderTournamentStandardTemplate(room),/BXH 賽事公版/);
});

test('public PTN projection does not publish the BXH template',()=>{
  const from=core.indexOf('function buildPublicEventInfo(');
  const to=core.indexOf('const AI_CREATE_SCHEMA_VERSION',from);
  const context={normalizeEventInfoV2:x=>x,venueForEventState:()=>({name:'測試場',address:'',navigationEnabled:false}),normalizeGoogleMapsUrl:()=>'',EVENT_INFO_SCHEMA_VERSION:'bxh.event-info.v2'};
  vm.createContext(context);vm.runInContext(core.slice(from,to),context);
  const snapshot={id:'bxh-standard',version:3,rules:'BXH 規則'};
  const room={meta:{eventAuthority:'ticket'},eventInfo:{standardTemplate:{enabled:true,snapshot}}};
  assert.equal(context.buildPublicEventInfo(room).standardTemplate.enabled,false);
  room.meta.eventAuthority='official';
  assert.equal(context.buildPublicEventInfo(room).standardTemplate.enabled,true);
});
