const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('const BXH_INTERFACE_THEME_KEY=');
const end=html.indexOf('function themePickerHtml()',start);
assert(start>0 && end>start);
const stored=new Map();
const root={value:'gold',getAttribute(){return this.value;},setAttribute(key,value){this.value=value;}};
const context={
  localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
  document:{documentElement:root},
  window:{cloudAuth:{saveInterfaceTheme:async()=>({ok:true})}},
  showToast(){throw Error('unexpected theme save failure');},
  userProfile:null,firebaseUser:null
};
vm.createContext(context);
vm.runInContext(html.slice(start,end),context);
assert.equal(root.value,'gold');
context.firebaseUser={uid:'staff-A'};
context.userProfile={role:'staff',active:true};
vm.runInContext('restoreAccountInterfaceTheme("staff-A",userProfile)',context);
assert.equal(root.value,'gold','A staff account has no directive skin before opting in');
vm.runInContext('applyInterfaceTheme("directive",true)',context);
assert.equal(root.value,'directive');
assert.equal(stored.get('bxh.interface.theme.account.v1.staff-A'),'directive');
assert.equal(stored.get('bxh.interface.theme.entrance.uid.v1'),'staff-A');
context.firebaseUser=null;
context.userProfile=null;
vm.runInContext('syncInterfaceThemeVisibility()',context);
assert.equal(root.value,'directive','Signed-out entrance keeps the last eligible account theme');
context.firebaseUser={uid:'staff-B'};
context.userProfile={role:'staff',active:true};
vm.runInContext('restoreAccountInterfaceTheme("staff-B",userProfile)',context);
assert.equal(root.value,'gold','Another staff account must not inherit the first account skin');
assert.equal(stored.get('bxh.interface.theme.entrance.uid.v1'),'staff-B');
context.firebaseUser=null;
context.userProfile=null;
vm.runInContext('syncInterfaceThemeVisibility()',context);
assert.equal(root.value,'gold','Signed-out entrance follows the most recently used account');
context.firebaseUser={uid:'staff-A'};
context.userProfile={role:'staff',active:true};
vm.runInContext('restoreAccountInterfaceTheme("staff-A",userProfile)',context);
assert.equal(root.value,'directive','Returning account restores its own choice even in player mode');
context.firebaseUser={uid:'player-C'};
context.userProfile={role:'player',active:true,interfaceTheme:'directive'};
vm.runInContext('restoreAccountInterfaceTheme("player-C",userProfile)',context);
assert.equal(root.value,'gold','Players cannot display restricted skin even if cached');
const css=fs.readFileSync('client-entrance-theme.css','utf8');
assert(css.includes(':root[data-bxh-theme="directive"] .landing-role-cards .role-card-admin::before{content:"零"'));
assert(css.includes(':root[data-bxh-theme="directive"] .landing-role-cards .role-card-player::before{content:"初"'));
assert(css.includes(':root[data-bxh-theme="directive"] .landing-role-cards .role-card-guest::before{content:"貳"'));
console.log('PASS account theme isolation, eligibility and three entrance cards');
