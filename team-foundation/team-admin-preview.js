(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const allowed=p=>!!p?.uid&&p.role==='super_admin'&&p.active===true&&p.isTestAccount!==true;
function create({read,getIdentity,onChange=()=>{}}){
 let generation=0,disposed=false,owner=null;
 const state={loading:false,error:null,result:null,action:null,offset:0,query:''};
 const snapshot=()=>structuredClone(state);
 function clear(){generation++;owner=null;state.result=null;state.error=null;state.loading=false;state.action=null;onChange(snapshot());}
 function sync(){const p=getIdentity();if(!allowed(p)||owner&&owner!==p.uid)clear();return allowed(p);}
 async function load(action,extra={}){
  if(disposed||!sync())return {ok:false};
  if(!['list','ranking','members'].includes(action))return {ok:false};
  const uid=getIdentity().uid,ticket=++generation;owner=uid;state.loading=true;state.result=null;state.error=null;state.action=action;onChange(snapshot());
  const payload=action==='members'?{action,teamId:extra.teamId}:action==='ranking'?{action,query:{offset:0,limit:20}}:{action,query:{query:extra.query??state.query,offset:extra.offset??0,limit:20,sort:'strength_desc'}};
  if(action==='list'){state.query=payload.query.query;state.offset=payload.query.offset;}
  try{const result=await read(payload);if(disposed||ticket!==generation)return {ok:false};if(!allowed(getIdentity())||getIdentity().uid!==uid){clear();return {ok:false};}state.result=result;return {ok:true};}
  catch(_){if(!disposed&&ticket===generation){state.result=null;state.error='預覽無法載入，請確認權限與功能開關後重試。';}return {ok:false};}
  finally{if(!disposed&&ticket===generation){state.loading=false;onChange(snapshot());}}
 }
 return {snapshot,load,sync,dispose(){disposed=true;generation++;state.result=null;}};
}
function view(s){
 const nav='<p>唯讀預覽：不提供建隊、加入、審核或圖片上傳。</p><button data-preview="list">戰隊大廳</button> <button data-preview="ranking">戰隊排行</button>';
 if(s.loading)return nav+'<p role="status">載入中…</p>';
 if(s.error)return nav+'<p role="alert">'+esc(s.error)+'</p>';
 const r=s.result;if(!r)return nav;
 if(s.action==='members')return nav+'<h3>'+esc(r.name)+'</h3><ul>'+(r.members||[]).map(m=>'<li>'+esc(m.name)+'｜'+esc(({captain:'隊長',deputy:'副隊長',elite:'菁英隊員',member:'一般隊員'})[m.role]||'隊員')+'</li>').join('')+'</ul>';
 const items=r.items||[];
 return nav+(s.action==='list'?'<form data-preview-search><label>搜尋戰隊或隊長<input name="query" maxlength="100" value="'+esc(s.query)+'"></label><button>搜尋</button></form>':'')+'<ul>'+items.map(t=>'<li><button data-preview="members" data-team-id="'+esc(t.id)+'">'+esc(t.name)+'</button>｜戰力 '+esc(t.strength??'待確認')+'</li>').join('')+'</ul>'+(items.length?'':'<p>目前沒有可顯示的戰隊。</p>')+(s.action==='list'?'<p>第 '+(Math.floor(s.offset/20)+1)+' 頁</p>'+(s.offset>0?'<button data-preview="previous">上一頁</button>':'')+(s.offset+20<r.total?'<button data-preview="next">下一頁</button>':''):'');
}
const api={create,view,allowed};
if(typeof module==='object'&&module.exports){module.exports=api;return;}root.BXHTeamAdminPreview=api;
// Independent from the public player feature flag. Defaults to entirely absent.
if(root.BXH_TEAM_ADMIN_PREVIEW!==true||typeof render!=='function')return;
let host=null,controller=null;
const identity=()=>{const p=typeof userProfile==='object'?userProfile:null;return p?{uid:typeof currentAuthUid==='function'?currentAuthUid():null,role:p.role,active:p.active,isTestAccount:p.isTestAccount}:null;};
function close(){controller?.dispose();controller=null;host?.remove();host=null;}
function refresh(){
 if(root.BXH_TEAM_ADMIN_PREVIEW!==true||!allowed(identity())){close();return;}
 if(host){if(!controller.sync())close();return;}
 host=document.createElement('aside');host.setAttribute('aria-label','戰隊管理員預覽');host.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2300;max-width:calc(100vw - 24px);width:440px;max-height:80vh;overflow:auto;background:#17171c;color:#fff;padding:16px;border:1px solid #666;border-radius:12px';
 controller=create({getIdentity:identity,read:p=>root.engagementService.tournamentOperation('teamPreviewRead',p),onChange:s=>{if(host)host.innerHTML='<details open><summary>戰隊管理員唯讀預覽</summary>'+view(s)+'</details>';}});
 host.addEventListener('click',e=>{const b=e.target.closest('[data-preview]');if(!b||!host.contains(b))return;const s=controller.snapshot(),a=b.dataset.preview;if(a==='next'||a==='previous')void controller.load('list',{offset:Math.max(0,s.offset+(a==='next'?20:-20))});else void controller.load(a,{teamId:b.dataset.teamId});});
 host.addEventListener('submit',e=>{if(!e.target.matches('[data-preview-search]'))return;e.preventDefault();void controller.load('list',{query:String(new FormData(e.target).get('query')||''),offset:0});});
 document.body.append(host);void controller.load('list');
}
const previousRender=render;render=function(){previousRender.apply(this,arguments);refresh();};refresh();
})(typeof window==='object'?window:globalThis);
