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
 render(state);assert.equal(last.error,null);assert.equal(last.items.length,1);assert.equal(last.query,'');
 render({...state,query:{query:'BXH',mode:'review'}});assert.equal(last.query,'BXH');assert.equal(last.mode,'review');
 render({...state,loaded:false,error:'資料暫時無法載入'});assert.equal(last.error,'資料暫時無法載入');
});
test('frame form converts the selection and refuses unrecognized values',async()=>{
 let submit,payload,choice='7',prevented=0;
 const controller={search:async()=>{},dispose(){},snapshot:()=>({team:{id:'t'}}),operate:async(...args)=>{payload=args;}};
 const container={innerHTML:'',addEventListener:(event,fn)=>{if(event==='submit')submit=fn;},removeEventListener(){},replaceChildren(){},contains:()=>true,querySelectorAll:()=>[],ownerDocument:{createElement:()=>({setAttribute(){}})},append(){}};
 const original=global.FormData;global.FormData=class{get(){return choice;}};
 try{
  mount({container,ui:{css:'',tabs:()=>'',lobby:()=>''},controllers:{createTeamController:()=>controller},api:{}});
  const form={dataset:{teamForm:'frame'},closest:()=>form};const event={target:form,preventDefault:()=>prevented++};
  await submit(event);assert.deepEqual(payload,['frame','t',{frame:7}]);choice='';await submit(event);assert.equal(payload[2].frame,null);
  payload=null;choice='9';await submit(event);assert.equal(payload,null);assert.equal(prevented,3);
 }finally{global.FormData=original;}
});
test('captain image preview revokes old URLs and ignores results after unmount',async()=>{
 let change,resolveNext,created=0;const revoked=[],img={hidden:true},status={};let prepare=async()=>({});
 const oldEmblem=global.BXHTeamEmblem,oldCreate=global.URL.createObjectURL,oldRevoke=global.URL.revokeObjectURL;
 global.BXHTeamEmblem={prepare:file=>prepare(file)};global.URL.createObjectURL=()=>`blob:test${++created}`;global.URL.revokeObjectURL=url=>revoked.push(url);
 const controller={search:async()=>{},dispose(){},snapshot:()=>({team:{role:'captain'}})};
 const container={addEventListener:(name,fn)=>{if(name==='change')change=fn;},removeEventListener(){},replaceChildren(){},contains:()=>true,querySelector:s=>s.includes('preview')?img:status};
 try{
  const mounted=mount({container,ui:{},controllers:{createTeamController:()=>controller},api:{}});const input={hasAttribute:()=>true,files:[{type:'image/png'}]};
  await change({target:input});assert.equal(img.hidden,false);assert.equal(img.src,'blob:test1');assert.match(status.textContent,/尚未儲存/);
  prepare=()=>new Promise(resolve=>{resolveNext=resolve;});const pending=change({target:input});assert.deepEqual(revoked,['blob:test1']);mounted.destroy();resolveNext({});await pending;assert.equal(created,1);
 }finally{global.BXHTeamEmblem=oldEmblem;global.URL.createObjectURL=oldCreate;global.URL.revokeObjectURL=oldRevoke;}
});
test('captain uploads only the prepared preview through controller',async()=>{
 let change,click,operation;const img={hidden:true},status={},button={disabled:true,dataset:{teamAction:'emblem-upload'}};button.closest=()=>button;
 const oldEmblem=global.BXHTeamEmblem,oldCreate=global.URL.createObjectURL,oldRevoke=global.URL.revokeObjectURL;
 global.BXHTeamEmblem={prepare:async()=>new Blob(['abc'],{type:'image/webp'})};global.URL.createObjectURL=()=> 'blob:test';global.URL.revokeObjectURL=()=>{};
 const controller={search:async()=>{},dispose(){},snapshot:()=>({team:{id:'t',role:'captain'}}),operate:async(...args)=>(operation=args,{ok:true})};
 const container={addEventListener:(name,fn)=>{if(name==='change')change=fn;if(name==='click')click=fn;},removeEventListener(){},replaceChildren(){},contains:()=>true,querySelector:s=>s.includes('preview')?img:s.includes('status')?status:button};
 try{
  const mounted=mount({container,ui:{},controllers:{createTeamController:()=>controller},api:{}});const input={hasAttribute:()=>true,files:[{type:'image/png'}]};await change({target:input});assert.equal(button.disabled,false);
  await click({target:button});assert.deepEqual(operation,['emblem','t',{base64:'YWJj'}]);assert.match(status.textContent,/已儲存/);mounted.destroy();
 }finally{global.BXHTeamEmblem=oldEmblem;global.URL.createObjectURL=oldCreate;global.URL.revokeObjectURL=oldRevoke;}
});
test('image refresh of the same team preserves the captain preview',async()=>{
 let change,render,revoked=0;const img={},status={},button={disabled:true},team={id:'t',role:'captain'};
 const oldEmblem=global.BXHTeamEmblem,oldCreate=global.URL.createObjectURL,oldRevoke=global.URL.revokeObjectURL;
 global.BXHTeamEmblem={prepare:async()=>new Blob(['abc'])};global.URL.createObjectURL=()=> 'blob:preview';global.URL.revokeObjectURL=()=>revoked++;
 const controller={search:async()=>{},dispose(){},snapshot:()=>({team})};
 const container={innerHTML:'',addEventListener:(name,fn)=>{if(name==='change')change=fn;},removeEventListener(){},replaceChildren(){},contains:()=>true,querySelectorAll:()=>[],querySelector:s=>s.includes('preview')?img:s.includes('status')?status:button};
 try{
  const mounted=mount({container,ui:{css:'',tabs:()=>'',myTeam:()=>''},controllers:{createTeamController:({onChange})=>(render=onChange,controller)},api:{}});
  await change({target:{hasAttribute:()=>true,files:[{}]}});render({screen:'mine',team,loaded:true,loading:false,busy:false});assert.equal(img.src,'blob:preview');assert.equal(button.disabled,false);assert.equal(revoked,0);mounted.destroy();assert.equal(revoked,1);
 }finally{global.BXHTeamEmblem=oldEmblem;global.URL.createObjectURL=oldCreate;global.URL.revokeObjectURL=oldRevoke;}
});
test('creation with a custom image prepares it before create and uploads to the new team',async()=>{
 let submit,team=null;const calls=[],oldForm=global.FormData,oldEmblem=global.BXHTeamEmblem;
 global.FormData=class{get(name){return {name:'新戰隊',presetId:'bolt',presetColor:'#11AA22',customEmblem:{size:3}}[name];}};global.BXHTeamEmblem={prepare:async()=>new Blob(['abc'],{type:'image/webp'})};
 const controller={search:async()=>{},dispose(){},snapshot:()=>({team,screen:team?'mine':'create'}),operate:async(action,id,extra)=>{calls.push({action,id,extra});if(action==='create')team={id,role:'captain'};return {ok:true};}};
 const container={contains:()=>true,addEventListener:(name,fn)=>{if(name==='submit')submit=fn;},removeEventListener(){},replaceChildren(){}};
 try{mount({container,ui:{},controllers:{createTeamController:()=>controller},api:{}});const form={dataset:{teamForm:'create'},closest:()=>form};await submit({target:form,preventDefault(){}});assert.equal(calls.length,2);assert.equal(calls[0].action,'create');assert.deepEqual(calls[0].extra.preset,{id:'bolt',color:'#11AA22'});assert.equal(calls[1].action,'emblem');assert.equal(calls[1].id,calls[0].id);assert.equal(calls[1].extra.base64,'YWJj');}
 finally{global.FormData=oldForm;global.BXHTeamEmblem=oldEmblem;}
});
