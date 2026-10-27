'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mount}=require('./team-mount.js');
test('lobby keeps loaded data on command rejection but hides data after load failure',()=>{
 let render,last;
 const controller={search:async()=>{},dispose(){}};
 const controllers={createTeamController:({onChange})=>(render=onChange,controller)};
 const ui={css:'',tabs:()=>'',lobby:s=>(last=s,'lobby')};
 const container={innerHTML:'',ownerDocument:{createElement:()=>({setAttribute(){},textContent:''})},append(){},addEventListener(){},removeEventListener(){},replaceChildren(){},querySelectorAll(){return [];}};
 mount({container,ui,controllers,api:{}});
 const state={screen:'lobby',loading:false,loaded:true,query:{},items:[{id:'t'}],error:'戰隊已滿員。',busy:false,pending:false};
 render(state);assert.equal(last.error,null);assert.equal(last.items.length,1);
 render({...state,loaded:false,error:'資料暫時無法載入'});assert.equal(last.error,'資料暫時無法載入');
});
