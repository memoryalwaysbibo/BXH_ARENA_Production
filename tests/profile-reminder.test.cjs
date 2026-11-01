const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
function setup(storage=new Map()){
  const context=vm.createContext({window:{}});
  for(const file of ['account-utils.js','profile-reminder.js'])vm.runInContext(fs.readFileSync(path.join(root,'modules/main-app',file),'utf8'),context);
  const create=(getStorage=()=>({getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}))=>context.window.BXHProfileReminder.create({storage:getStorage,gameId:context.window.BXHAccountUtils.effectiveGameId});
  return {create,storage};
}
const auth=(uid='a',time='login-1')=>({uid,metadata:{lastSignInTime:time}});
const profile=(extra={})=>({uid:'a',active:true,phone:'',gameId:'',...extra});
function login(c,user=auth()){c.syncAuth(user);c.acceptProfile(user.uid);}
test('all login providers and old players use the same two-field check',()=>{
  const {create}=setup();
  for(const provider of ['google.com','password',undefined]){
    const c=create();login(c);
    assert.equal(c.shouldPrompt('a',profile({provider})),true);
    assert.equal(c.shouldPrompt('a',profile({phone:'0912345678'})),true);
    assert.equal(c.shouldPrompt('a',profile({gameId:'黑爸'})),true);
    assert.equal(c.shouldPrompt('a',profile({phone:'0912345678',gameId:'黑爸',realName:'',birthDate:''})),false);
  }
});
test('legacy nickname and distinct displayName remain valid role names; real name alone does not',()=>{
  const {create}=setup();const c=create();login(c);
  for(const extra of [{nickname:'舊角色'},{displayName:'舊角色',realName:'本名'}])assert.equal(c.shouldPrompt('a',profile({phone:'09',...extra})),false);
  assert.equal(c.shouldPrompt('a',profile({phone:'09',displayName:'本名',realName:'本名'})),true);
  assert.equal(c.shouldPrompt('a',profile({phone:'   ',gameId:'   '})),true);
});
test('Next time survives rerender, auth refresh and page reload but not the next login',()=>{
  const {create}=setup();let c=create();login(c);c.defer();
  assert.equal(c.shouldPrompt('a',profile()),false);
  login(c);assert.equal(c.shouldPrompt('a',profile()),false);
  c=create();login(c);assert.equal(c.shouldPrompt('a',profile()),false);
  login(c,auth('a','login-2'));assert.equal(c.shouldPrompt('a',profile()),true);
  c.defer();c.syncAuth(null);login(c,auth('a','login-2'));assert.equal(c.shouldPrompt('a',profile()),true);
});
test('account switches, failed profile reads, guests and inactive profiles cannot leak reminders',()=>{
  const {create}=setup();const c=create();login(c);c.defer();
  c.syncAuth(auth('b'));assert.equal(c.shouldPrompt('b',profile({uid:'b'})),false);
  c.acceptProfile('a');assert.equal(c.shouldPrompt('b',profile({uid:'b'})),false);
  c.acceptProfile('b');assert.equal(c.shouldPrompt('b',profile()),false);
  assert.equal(c.shouldPrompt('b',profile({uid:'b'})),true);
  assert.equal(c.shouldPrompt('b',profile({uid:'b',active:false})),false);
  assert.equal(c.shouldPrompt('b',null),false);
  c.syncAuth(null);assert.equal(c.shouldPrompt('',profile()),false);
});
test('blocked sessionStorage still allows dismissing once for the current page session',()=>{
  const {create}=setup();const c=create(()=>{throw Error('blocked');});login(c);c.defer();
  assert.equal(c.shouldPrompt('a',profile()),false);
  login(c);assert.equal(c.shouldPrompt('a',profile()),false);
});
