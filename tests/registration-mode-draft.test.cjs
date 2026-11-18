const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('selecting online registration does not write an incomplete room to cloud', () => {
  const source = fs.readFileSync(path.join(__dirname, '../modules/main-app/core.js'), 'utf8');
  const start = source.indexOf('  if(action==="set-registration-enabled"){');
  const end = source.indexOf('  if(action==="set-registration-draft-visibility"){', start);
  assert.ok(start > 0 && end > start);
  const state = { bracketSize: 0, meta: { registrationEnabled: false, registrationCapacity: null } };
  const draft = { registrationEnabled: false, registrationCapacity: null };
  let writes = 0;
  const context = {
    state,
    registrationFormDraft: draft,
    registrationFormDraftDirty: false,
    aiCreateLastApplied: null,
    syncSettingsDraftFromDom() {},
    ensureRegistrationFormDraft() {},
    render() {},
    showToast() {},
    onsiteRegistrationSettingsLocked:()=>false,
    reportManagedRegistrationSettings() {},
    saveState() { writes++; return Promise.resolve(true); },
  };
  vm.createContext(context);
  vm.runInContext(`function selectMode(action,target){${source.slice(start, end)}}`, context);
  context.selectMode('set-registration-enabled', { getAttribute() { return 'true'; } });
  assert.equal(draft.registrationEnabled, true);
  assert.equal(context.registrationFormDraftDirty, true);
  assert.equal(state.meta.registrationEnabled, false);
  assert.equal(writes, 0);
});


test('new official drafts use online signup without changing an existing room or roster',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
  const code=source.slice(source.indexOf('function ensureRegistrationFormDraft(){'),source.indexOf('function resetRegistrationFormDraft(){'));
  for(const [label,extra,expected] of [
    ['new official',{},true],
    ['existing cloud room',{cloudCode:'BXH-7VKPPC'},false],
    ['existing local roster',{players:[{id:'p1',name:'選手',checkedIn:true}]},false],
    ['existing bracket',{bracketSize:4},false],
    ['community',{meta:{eventAuthority:'community',registrationEnabled:false}},false]
  ]){
    const state={meta:{eventAuthority:'official',registrationEnabled:false},players:[],...extra},before=JSON.stringify(state);
    const context={state,registrationFormDraft:null,registrationFormDraftDirty:false,registrationParticipantNameMode:v=>v||'realName'};
    vm.createContext(context);vm.runInContext(code,context);context.ensureRegistrationFormDraft();
    assert.equal(context.registrationFormDraft.registrationEnabled,expected,label);
    assert.equal(JSON.stringify(state),before,label+' must not mutate room data');
    assert.equal(context.registrationFormDraftDirty,false);
  }
});

test('retired onsite mode action cannot turn an online draft off',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
 const start=source.indexOf('  if(action==="set-registration-enabled"){'),end=source.indexOf('  if(action==="set-registration-draft-visibility"){',start);
 const context={state:{bracketSize:0},registrationFormDraft:{registrationEnabled:true},registrationFormDraftDirty:false,onsiteRegistrationSettingsLocked:()=>false,syncSettingsDraftFromDom(){},ensureRegistrationFormDraft(){},showToast(){},render(){throw Error('must not render a retired mode');}};
 vm.createContext(context);vm.runInContext(`function selectMode(action,target){${source.slice(start,end)}}`,context);
 context.selectMode('set-registration-enabled',{getAttribute:()=> 'false'});
 assert.equal(context.registrationFormDraft.registrationEnabled,true);
 assert.equal(context.registrationFormDraftDirty,false);
});
