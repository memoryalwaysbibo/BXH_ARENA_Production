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
