'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'_resolve.cjs'))('playwright'));}
const C=require('./functions/core.cjs');
const root=path.join(__dirname,'..'),script=fs.readFileSync(path.join(root,'modules/main-app/referee-seats.js'),'utf8'),css=fs.readFileSync(path.join(root,'modules/main-app/referee-seats.css'),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const room={createdBy:'host',eventAuthority:'official',assignedStaffUids:['main','backup','other'],refereeStationAssignments:{}},state={id:'r',cloudCode:'BXH-TEST',meta:{eventAuthority:'official',stations:1},matches:[]};
 const users=Object.fromEntries(['host','main','backup','other'].map(uid=>[uid,{active:true,role:'staff',realName:uid==='main'?'阿豪':uid==='backup'?'鼎皓':uid==='other'?'竣能':'黑爸'}]));
 let seq=0;const clients=[];
 let out=C.transition({room,state,user:users.host,uid:'host',d:{action:'enable'},now:Date.now(),id:'enable'});room.refereeSeatsV1=out.model;Object.assign(room,out.projection);
 async function broadcast(){for(const {page} of clients)await page.evaluate(({model,projection})=>window.receive({model,projection}),{model:room.refereeSeatsV1,projection:C.project(room.refereeSeatsV1)});}
 async function client(uid){
  const page=await browser.newPage({viewport:{width:390,height:844}});clients.push({page,uid});
  await page.exposeFunction('command',async d=>{
   const r=C.transition({room,state,user:users[uid],uid,d,now:Date.now(),id:'req'+(++seq),targetUser:users[room.refereeSeatsV1.courts[d.station]?.[d.slot]?.uid],requesterUser:users[room.refereeSeatsV1.requests[d.requestId]?.fromUid]});
   room.refereeSeatsV1=r.model;Object.assign(room,r.projection);setImmediate(()=>broadcast().catch(()=>{}));return r.result;
  });
  await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#101116;color:#fff;font-family:sans-serif}.card{margin:12px;border:1px solid #444;border-top:5px solid #5264ff;border-radius:10px}.head{padding:16px}.btn{padding:10px;border:1px solid #666;border-radius:8px;background:#242735;color:white;font-size:14px}#toast{padding:12px}</style><style>'+css+'</style><div class="card"><div class="head">台 1｜責任裁判</div><div id="seats"></div><div class="head">比分 2：1</div></div><div id="toast" role="status"></div>');
  await page.addScriptTag({content:script});
  await page.evaluate(({uid,model,projection})=>{
   window.st={id:'r',cloudCode:'BXH-TEST',meta:{eventAuthority:'official',stations:1,assignedStaffUids:['main','backup','other'],...projection,refereeSeatsV1:model}};
   window.cloudSync={manageRefereeSeats:window.command,subscribeRefereeSeats:(code,callback)=>{window.receive=callback;return ()=>{};}};
   const draw=()=>{window.BXHRefereeSeats.bind({state:()=>st,uid:()=>uid,eligible:()=>true,operator:()=>true,manager:()=>uid==='host',render:draw,toast:(t)=>document.getElementById('toast').textContent=t});document.getElementById('seats').innerHTML=BXHRefereeSeats.render(st,1);};
   draw();
  },{uid,model:room.refereeSeatsV1,projection:C.project(room.refereeSeatsV1)});
  return page;
 }
 const main=await client('main'),backup=await client('backup'),other=await client('other');
 await main.locator('[data-slot="main"]').click();await main.waitForFunction(()=>st.meta.refereeSeatsV1.courts['1'].main?.uid==='main');
 await backup.locator('[data-slot="backup1"]').click();await backup.waitForFunction(()=>st.meta.refereeSeatsV1.courts['1'].backup1?.uid==='backup');
 // Exactly three seat controls and no horizontal overflow on all target widths.
 for(const width of [320,390,430,960]){
  await main.setViewportSize({width,height:900});assert.equal(await main.locator('.ref-seat-button').count(),3);
  assert(await main.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  if(process.env.SEAT_SCREENSHOT_DIR){fs.mkdirSync(process.env.SEAT_SCREENSHOT_DIR,{recursive:true});await main.screenshot({path:path.join(process.env.SEAT_SCREENSHOT_DIR,'referee-seats-'+width+'.png')});}
 }
 // Backup clicks occupied main seat and requests a swap.
 await backup.locator('[data-slot="main"]').click();await backup.getByRole('button',{name:'提出權限交接',exact:true}).click();
 await backup.locator('.ref-seat-wait').filter({hasText:'等待對方確認中'}).waitFor();
 await main.getByRole('dialog').waitFor();assert((await main.getByRole('dialog').innerText()).includes('鼎皓 向您提出 1 號台「主裁判」交接申請'));
 await main.getByRole('dialog').getByRole('button',{name:'確定',exact:true}).click();await backup.waitForFunction(()=>st.meta.refereeSeatsV1.courts['1'].main?.uid==='backup');
 assert.equal(room.refereeSeatsV1.courts['1'].backup1.uid,'main');
 // Other asks for backup1; holder declines and applicant receives precise cancellation.
 await other.locator('[data-slot="backup1"]').click();await other.getByRole('button',{name:'提出權限交接',exact:true}).click();await main.getByRole('dialog').waitFor();await main.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 await other.getByText('對方取消交接',{exact:true}).waitFor();
 // New main revokes backup, who immediately loses seat-based permission.
 await backup.locator('[data-slot="backup1"]').click();await backup.getByRole('button',{name:'撤銷此席位',exact:true}).click();await backup.getByRole('dialog').getByRole('button',{name:'確定',exact:true}).click();await main.waitForFunction(()=>!BXHRefereeSeats.canScore(st,1,'main'));
 // Own-seat exit can be cancelled without mutation, then confirmed.
 await backup.locator('[data-slot="main"]').click();assert((await backup.getByRole('dialog').innerText()).includes('是否退出 1 號台主裁判'));
 await backup.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert.equal(room.refereeSeatsV1.courts['1'].main.uid,'backup');
 await backup.locator('[data-slot="main"]').click();await backup.getByRole('dialog').getByRole('button',{name:'確定',exact:true}).click();await backup.waitForFunction(()=>!st.meta.refereeSeatsV1.courts['1'].main);
 console.log('PASS three-device join, swap, rejection notification, revoke, exit, and 320/390/430/960 layout');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
