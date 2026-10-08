(function(root){
'use strict';
let user=null,profile=null,epoch=0,authorized=false,changed=()=>{};
async function transport(operation,input,{uid,signal}={}){
 const owner=user,stamp=epoch;if(!authorized||!owner||uid!==owner.uid||profile?.active!==true)throw Error('account-unavailable');
 const connection=root.engagementService?.connectionInfo();if(connection?.projectId!=='bxh-arena'||!root.engagementService?.hunterClash)throw Error('closed');
 if(signal?.aborted)throw Error('aborted');
 try{const result=await root.engagementService.hunterClash({operation,input});if(stamp!==epoch||user!==owner||signal?.aborted)throw Error('aborted');return result;}
 catch(error){const code=String(error.code||'');if(['failed-precondition','invalid-argument','permission-denied','unauthenticated','aborted','resource-exhausted','not-found'].some(v=>code.endsWith('/'+v)||code===v))error.definitive=true;throw error;}
}
const history=root.BXHArenaPKHistory.createHistory({transport,changed:()=>changed()});
function setSession(next,p,allowed){
 const changedOwner=user!==next||user?.uid!==next?.uid;user=next;profile=p;authorized=allowed===true&&p?.active===true;
 if(changedOwner||!authorized){epoch++;history.session(authorized?user?.uid:null);}
 else history.session(user?.uid);
}
function displayRecords(formal){return authorized&&['ready','empty','loading','partial','error'].includes(history.snapshot().status)?[...formal,...history.snapshot().records]:formal;}
function state(){return authorized?history.snapshot():{status:'unconnected',records:[],total:null};}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function statusHtml(){const s=state(),labels={unconnected:'PK 服務尚未開通',loading:'正在核對完整 PK 帳本',partial:'PK 部分頁面未讀取完成',error:'PK 戰績讀取失敗',empty:'尚無已確認 PK 戰績',ready:'PK 完整帳本已讀取'};return '<section class="panel" role="status"><strong>'+labels[s.status]+'</strong><p class="hint">'+(s.status==='ready'?s.records.length+' 場；排除 '+s.excluded+' 場回合不完整資料。':'讀取尚未完成時不以零戰績計算生涯。')+' PK 為雙方確認（SELF），不計 XP、成就、正規實力或階級。</p><button class="btn btn-ghost btn-sm" data-action="hunter-pk-refresh" '+(s.status==='loading'?'disabled':'')+'>更新 PK 戰績</button></section>';}
function renderLicense({tab,analyze,radar,card,records}){
 const s=state(),ready=['ready','empty'].includes(s.status);let html=statusHtml();
 if(!ready)return html;
 const rows=records||s.records;
 if(tab==='records')return html+'<section class="panel"><div class="panel-title">PK 對戰紀錄</div>'+rows.map(card).join('')+'</section>';
 const a=analyze(rows),wins=rows.filter(r=>r.isWin).length;
 html+='<section class="panel"><div class="panel-title">PK 戰績與分布</div><p>'+rows.length+' 場 · '+wins+' 勝 '+(rows.length-wins)+' 敗 · 勝率 '+(rows.length?Math.round(wins/rows.length*100)+'%':'—')+'</p><p class="hint">可分析 '+a.matches+' 場｜'+a.validRounds+' 有效回合。八角圖以 100% 為滿格；次數／分數可切換。PK 不產生綜合能力分。</p>'+radar(a)+'</section>';
 return html;
}
let vendors=null;
function loadVendors(){if(vendors)return vendors;vendors=Promise.all([['QRCode','qrcode.min.js'],['jsQR','jsQR.js']].map(([symbol,file])=>typeof root[symbol]==='function'?Promise.resolve():new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('hunter-clash/arena/vendor/'+file+'?v=20261009-a23',document.baseURI).href;script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('qr-library-unavailable'));};document.head.append(script);}))).catch(error=>{vendors=null;throw error;});return vendors;}
async function mount(host){
 const owner=user,stamp=epoch;if(!authorized||!owner)return null;
 await loadVendors();const module=await import('./mobile.mjs?v=20261009-a23');if(stamp!==epoch||user!==owner||!authorized)return null;
 const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<link rel="stylesheet" href="hunter-clash/arena/mobile.css?v=20261009-a23"><div id="message" role="status"></div><div id="app"></div>';
 return module.mountMobile(shadow,{transport,playerName:()=>profile?.displayName||profile?.nickname||profile?.gameId||profile?.realName||'未設定名稱',watch:fn=>{queueMicrotask(()=>{if(stamp===epoch)fn(owner);});return()=>{};},history:force=>history.load(force)},{storage:sessionStorage});
}
root.BXHArenaPK={setSession,transport,displayRecords,state,statusHtml,renderLicense,mount,load:force=>history.load(force),listen:fn=>{changed=fn;}};
})(globalThis);
