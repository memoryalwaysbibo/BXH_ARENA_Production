'use strict';
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((_,r)=>r.end('<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:12px}button{max-width:100%;white-space:normal}.btn-row{display:flex;flex-wrap:wrap;gap:8px}.panel{padding:12px}</style><main id="app"></main><p id="notice"></p>'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.addScriptTag({content:fs.readFileSync('modules/main-app/bracket-commit.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync('modules/main-app/admin-override.js','utf8')});
 const core=fs.readFileSync('modules/main-app/core.js','utf8'),a=core.indexOf('// Bracket generation is detached'),b=core.indexOf('function currentRoundLabelForBoard(){',a);
 assert(a>0&&b>a);
 await page.addScriptTag({content:`
 let state={id:'r',cloudCode:'ROOM',meta:{formatType:'single'},players:[{id:'a'},{id:'b'}],matches:[],archiveStatus:'ongoing'},firebaseUser={uid:'u'},currentRole='admin',activeTab='people',userProfile={active:true,role:'player'},pendingModal=null;
 const currentAuthUid=()=>firebaseUser.uid,eligiblePlayers=()=>state.players.filter(p=>p.checkedIn===true),currentBracketParticipantIds=()=>new Set(state.matches.flatMap(m=>[m.a?.playerId,m.b?.playerId]).filter(Boolean));
 const cloneStateForSave=x=>JSON.parse(JSON.stringify(x));
 function openModal(cfg){pendingModal=cfg;render();}
 const clone=x=>JSON.parse(JSON.stringify(x));
 let serverState=clone(state),publicState=clone(state),generations=0,success=0,writeCount=0,release=null,fail=true,failOnce=false,autoWrite=false,staleReads=0;
 window.cloudSync={
  readBracketFromServer:async()=>({ok:true,data:clone(serverState),publicData:staleReads-->0?{...clone(publicState),matches:[]}:clone(publicState)}),
  pushUpdate:async(code,snapshot,options)=>{writeCount++;if(failOnce){failOnce=false;return false;}if(fail)return false;if(!autoWrite)await new Promise(r=>release=r);BXHBracketCommit.assertWrite(serverState,snapshot,options);if(options.adminOperationalOverride)snapshot.adminOperationOverrides=BXHAdminOverride.record(options.adminOperationalOverride,{actorUid:'u',code,roomId:serverState.id},userProfile,serverState,snapshot);serverState=clone(snapshot);publicState=clone(snapshot);if(autoWrite)staleReads=1;return true;}
 };
 const enqueueCloudStateWrite=(code,snapshot,options)=>window.cloudSync.pushUpdate(code,snapshot,options);
 async function saveRecord(){return true;}
 function generateBracket(){generations++;state.drawnAt=100;state.bracketSize=2;state.matches=[{id:'m'+generations,bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}];return true;}
 function showToast(s){success++;document.querySelector('#notice').textContent=s;}
 function renderPreservingScroll(){render();}
 function entryRosterValid(){return true;}
 function bracketRosterIsCurrent(){return state.players.filter(p=>!state.meta.checkinRequired||p.checkedIn===true).map(p=>p.id).sort().join(',')===[...currentBracketParticipantIds()].sort().join(',');}
 function canOperateCurrentTournament(){return userProfile.role==='admin';}
 ${core.slice(a,b)}
 function render(){document.querySelector('#app').innerHTML=bracketCommitStatusHtml()+bracketDrawButtonHtml()+'<button id="start" '+(bracketCommitBlocked()?'disabled':'')+'>開賽</button>'+(pendingModal?'<section role="dialog"><h2>'+pendingModal.title+'</h2><p>'+pendingModal.message+'</p><button data-action="fixture-force-confirm">'+pendingModal.confirmLabel+'</button></section>':'');}
 document.addEventListener('click',e=>{if(e.target.dataset.action==='admin-force-draw')offerAdminOperationalOverride('draw-bracket','現場名單已核對，要求略過同步檢查');if(e.target.dataset.action==='admin-force-start')offerAdminOperationalOverride('start-tournament','現場對戰表已核對，要求略過同步檢查');if(e.target.dataset.action==='fixture-force-confirm'){const m=pendingModal;pendingModal=null;m.onConfirm();render();}if(e.target.dataset.action==='draw-bracket')bracketCommitController().submit();if(e.target.dataset.action==='bracket-commit-submit')bracketCommitController().submit();});
 window.fixture={changeCheckin:(id,value)=>{state.meta.checkinRequired=true;state.players.find(p=>p.id===id).checkedIn=value;render();},enableAdmin:()=>{userProfile.role='admin';state.cloudCode='BXH-X';state.players.forEach(p=>{p.name=p.id;p.checkedIn=true;});serverState=clone(state);publicState=clone(state);render();},revokeAdmin:()=>{userProfile.role='staff';render();},stats:()=>({generations,success,writeCount,local:clone(state),server:clone(serverState)}),retry:()=>{fail=false;},release:()=>release(),autoRecover:()=>{fail=false;failOnce=true;autoWrite=true;},canStart:()=>verifyBracketBeforeStart()};
 render();
 `});
 await page.getByRole('button',{name:'抽籤',exact:true}).click();
 await page.getByRole('status').getByText('資料上傳中…',{exact:true}).waitFor();
 await page.getByRole('progressbar',{name:'資料上傳中'}).waitFor();
 await page.waitForTimeout(250);
 assert.equal(await page.getByRole('status').getAttribute('aria-busy'),'true');
 await page.getByRole('button',{name:'重試上傳'}).waitFor();
 assert.equal(await page.locator('#start').isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'抽籤',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'讀取雲端版本',exact:true}).count(),0);
 assert.equal(await page.getByRole('status').getByRole('button').count(),1);
 await page.getByRole('status').getByText('上傳失敗',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>fixture.stats())).success,0);
 await page.evaluate(()=>fixture.retry());
 await page.getByRole('button',{name:'重試上傳'}).click();
 await page.getByRole('button',{name:'上傳中…',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'上傳中…',exact:true}).isDisabled(),true);
 const during=await page.evaluate(()=>fixture.stats());assert.equal(during.generations,1);assert.equal(during.success,0);assert.equal(during.local.matches.length,0);
 await page.evaluate(()=>fixture.release());
 await page.locator('#notice').getByText('上傳成功',{exact:true}).waitFor();
 assert.equal(await page.locator('#start').isDisabled(),false);
 const after=await page.evaluate(()=>fixture.stats());assert.equal(after.generations,1);assert.equal(after.success,1);assert.equal(after.local.bracketDrawHistory.length,1);assert.equal(after.local.matches[0].id,after.server.matches[0].id);
 assert.equal(await page.evaluate(()=>fixture.canStart()),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>fixture.autoRecover());
 const writesBefore=(await page.evaluate(()=>fixture.stats())).writeCount;
 await page.getByRole('button',{name:'重新抽籤',exact:true}).click();
 await page.getByRole('status').getByText('資料上傳中…',{exact:true}).waitFor();
 assert.equal(await page.locator('#start').isDisabled(),true);
 await page.getByRole('status').getByText('上傳成功',{exact:true}).waitFor({timeout:15000});
 const recovered=await page.evaluate(()=>fixture.stats());
 assert.equal(recovered.generations,2);assert.equal(recovered.success,2);assert.equal(recovered.writeCount-writesBefore,2);
 assert.equal(await page.getByRole('button',{name:'重試上傳',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'管理員強制抽籤',exact:true}).count(),0,'A player profile cannot see override controls');
 
 await page.evaluate(()=>{fixture.changeCheckin('b',true);fixture.changeCheckin('a',false);});
 await page.getByRole('alert').getByText('對戰表待更新',{exact:true}).waitFor();
 assert.equal(await page.getByRole('status').count(),0,'Old upload success must not mask roster changes');
 assert.equal(await page.getByRole('button',{name:'依最新名單重新抽籤',exact:true}).count(),0,'Observers cannot redraw');
 assert.equal((await page.evaluate(()=>fixture.stats())).generations,2,'Check-in changes do not automatically redraw');
 await page.evaluate(()=>fixture.enableAdmin());
 assert.equal(await page.getByRole('alert').count(),0,'Restoring the original entry roster clears the warning');
 await page.evaluate(()=>fixture.changeCheckin('a',false));
 await page.getByRole('alert').getByRole('button',{name:'依最新名單重新抽籤',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>fixture.changeCheckin('a',true));
 const forcedWrites=(await page.evaluate(()=>fixture.stats())).writeCount;
 await page.getByRole('button',{name:'管理員強制抽籤',exact:true}).click();
 await page.getByRole('dialog').getByRole('heading',{name:'管理員強制抽籤確認'}).waitFor();
 assert.equal((await page.evaluate(()=>fixture.stats())).writeCount,forcedWrites,'Opening warning does not execute');
 await page.getByRole('button',{name:'我已核對，強制執行',exact:true}).click();
 await page.waitForFunction(()=>fixture.stats().local.adminOperationOverrides?.length===1);
 await page.getByRole('status').getByText('上傳成功',{exact:true}).waitFor();
 const forced=await page.evaluate(()=>fixture.stats());assert.equal(forced.generations,3);assert.equal(forced.local.adminOperationOverrides[0].operation,'draw-bracket');
 await page.getByRole('button',{name:'管理員強制開賽',exact:true}).click();
 await page.evaluate(()=>fixture.revokeAdmin());
 const beforeRevoke=(await page.evaluate(()=>fixture.stats())).writeCount;
 await page.getByRole('button',{name:'我已核對，強制執行',exact:true}).click();
 await page.waitForTimeout(100);
 assert.equal((await page.evaluate(()=>fixture.stats())).writeCount,beforeRevoke,'Role revocation invalidates confirmation');
 assert.equal(await page.getByRole('button',{name:'管理員強制開賽',exact:true}).count(),0);
 await page.evaluate(()=>fixture.enableAdmin());
 await page.getByRole('button',{name:'管理員強制開賽',exact:true}).click();
 await page.getByRole('dialog').getByRole('heading',{name:'管理員強制開賽確認'}).waitFor();
 await page.getByRole('button',{name:'我已核對，強制執行',exact:true}).click();
 await page.waitForFunction(()=>fixture.stats().local.startedAt&&fixture.stats().local.adminOperationOverrides?.length===2);
 assert.equal((await page.evaluate(()=>fixture.stats())).local.adminOperationOverrides[1].operation,'start-tournament');
 await page.evaluate(()=>fixture.changeCheckin('a',false));
 assert.equal(await page.getByRole('alert').count(),0,'Started matches never offer roster redraw');
 assert.equal(await page.getByRole('button',{name:'重新抽籤',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'管理員強制抽籤',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS admin mobile confirmation, player exclusion, role revocation, forced draw/start and audit readback');
 console.log('PASS single-action bracket UI and actual bridge: failed save, disabled start/redraw, delayed retry, same pairing, server confirmation and mobile width');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

