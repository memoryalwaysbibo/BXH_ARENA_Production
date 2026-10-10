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
function practiceXpHtml(){
 const s=state(),p=['ready','empty'].includes(s.status)?s.practiceXp:null;
 return '<div class="panel practice-xp"><strong>練習 XP</strong><p>'+(!p?'XP 尚未完成核對，請更新戰績。':!p.enabled?'練習 XP 發放已暫停；既有 XP 保留。':p.day!==new Date(Date.now()+8*3600000).toISOString().slice(0,10)?'日期已更新，請更新戰績核對今日額度。':'今日已獲 '+p.todayXp+' XP · 剩餘 '+p.remainingGames+' 場額度（仍受同對手限制）')+'</p><details><summary>XP 發放規則</summary><p class="hint">每日前 10 場；同對手前 3 場每場 5 XP，第 4～6 場每場 2.5 XP，第 7 場起 0 XP。雙方結案時依台灣日期計算，午夜重置；額度之外仍保存戰績。只計啟用後建立的對戰，不補發舊紀錄。</p></details></div>';
}
function achievementsHtml(){
 const s=state();if(!['ready','empty'].includes(s.status))return '<section class="panel"><strong>PK 專屬成就</strong><p>完整戰績尚未核對，暫不判定成就資格。</p><button class="btn btn-ghost" data-action="hunter-pk-refresh">更新 PK 戰績</button></section>';
 const result=root.BXHPKAchievements.summarize(s.records);
 return '<section class="panel pk-badge-panel"><strong>PK 專屬成就</strong><p class="hint">生涯累積 · 已計入 '+result.matches+' 場 · '+result.wins+' 勝 · '+result.opponents+' 位不同對手</p><div class="hunter-analysis-grid">'+result.badges.map(b=>'<div class="panel"><span class="badge '+(b.unlocked?'badge-neon':'badge-metal')+'">'+(b.unlocked?'◆ 已解鎖':'◇ 未解鎖')+'</span><h3>'+b.name+'</h3><p>'+b.current+' / '+b.target+(b.metric==='opponents'?' 位對手':b.metric==='wins'?' 勝':b.metric==='bestStreak'?' 連勝':b.metric==='comebacks'?' 場逆轉':' 場')+'</p><p class="hint">'+(b.unlocked?'已達成':b.metric==='bestStreak'?'最佳紀錄還差 '+(b.target-b.current)+' 連勝':b.metric==='comebacks'?'還差 '+(b.target-b.current)+' 場逆轉獲勝':'還差 '+(b.target-b.current)+(b.metric==='opponents'?' 位不同對手':b.metric==='wins'?' 勝':' 場'))+'</p>'+(b.id==='comeback'?'<p class="hint">曾以 0：3 落後，最後逆轉獲勝，雙方確認結案後計入。</p>':'')+'</div>').join('')+'</div><details><summary>成就計算規則</summary><p class="hint">只計更新後新建立、雙方確認結案的對戰。每個台灣日期前 10 場，同對手前 6 場；撤銷後重新核對資格，不返還當日額度。額度以結案順序計算，生涯成就不隨期間篩選改變。勝場成就只計符合上述資格的勝場。連勝依結案順序跨日累積，超額勝場不增加；敗場（含超額）或回合資料不完整會中斷。三連勝顯示生涯最佳紀錄。逆轉獵人須在同一場對戰中曾出現本人 0 分、對手 3 分（0：3），最後逆轉獲勝，且雙方確認結案。1：3 或 2：3 後逆轉不計；0：3 後落敗也不計。既有合資格紀錄依此條件重新核對。徽章不另發 XP、稱號或正式階級獎勵。</p></details></section>';
}
function practiceGrowth(growth){
 const s=state(),p=['ready','empty'].includes(s.status)?s.practiceXp:null;
 if(!p)return {...growth,xpFromPractice:null,practiceXpReady:false};
 return {...root.BXHHunterUtils.hunterGrowthWithPractice(growth,p.totalXp),practiceXpReady:true};
}
function statusHtml(){const s=state(),labels={unconnected:'PK 服務尚未開通',loading:'正在核對完整 PK 帳本',partial:'PK 部分頁面未讀取完成',error:'PK 戰績讀取失敗',empty:'尚無已確認 PK 戰績',ready:'PK 完整帳本已讀取'};return '<section class="panel" role="status"><strong>'+labels[s.status]+'</strong><p class="hint">'+(s.status==='ready'?s.records.length+' 場；排除 '+s.excluded+' 場回合不完整資料。':'讀取尚未完成時不以零戰績計算生涯。')+' PK 為雙方確認（SELF）；符合額度的練習 XP 累積獵人等級，PK 徽章獨立計算，不計既有永久成就、正規實力或階級。</p><button class="btn btn-ghost btn-sm" data-action="hunter-pk-refresh" '+(s.status==='loading'?'disabled':'')+'>更新 PK 戰績</button></section>';}
function renderLicense({tab,analyze,radar,card,records}){
 const s=state(),ready=['ready','empty'].includes(s.status);let html=statusHtml()+practiceXpHtml();
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
 await loadVendors();const module=await import('./mobile.mjs?v=20261010-pk-feedback-1');if(stamp!==epoch||user!==owner||!authorized)return null;
 const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<link rel="stylesheet" href="hunter-clash/arena/mobile.css?v=20261010-pk-feedback-1"><div id="message" role="status"></div><div id="app"></div>';
 return module.mountMobile(shadow,{transport,playerName:()=>profile?.displayName||profile?.nickname||profile?.gameId||profile?.realName||'未設定名稱',watch:fn=>{queueMicrotask(()=>{if(stamp===epoch)fn(owner);});return()=>{};},history:force=>history.load(force),achievementUnlocks:(records,id)=>root.BXHPKAchievements.newUnlocks(records,id),xpHtml:practiceXpHtml,achievementsHtml},{storage:sessionStorage,accountStorage:localStorage});
}
root.BXHArenaPK={achievementsHtml,practiceXpHtml,practiceGrowth,setSession,transport,displayRecords,state,statusHtml,renderLicense,mount,load:force=>history.load(force),listen:fn=>{changed=fn;}};
})(globalThis);
