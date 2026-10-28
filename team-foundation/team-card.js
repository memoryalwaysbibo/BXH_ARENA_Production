(function(root){
'use strict';
const valid=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
const roles={captain:'隊長',deputy:'副隊長',elite:'菁英隊員',member:'一般隊員'};
async function load({uid,read}){
 if(!valid(uid)||typeof read!=='function')return {state:'unavailable'};
 try{
  const result=await read({action:'card-team',targetUid:uid});
  if(result?.team===null)return {state:'none'};
  const t=result?.team;if(!valid(t?.id)||typeof t.name!=='string'||!t.name.trim()||!Object.hasOwn(roles,t.role)||!Number.isSafeInteger(t.level)||t.level<1||t.level>10)return {state:'unavailable'};
  const info={state:'team',team:{id:t.id,name:t.name,role:t.role,level:t.level,selectedFrame:[4,7,10].includes(t.selectedFrame)&&t.selectedFrame<=t.level?t.selectedFrame:null}};
  if(t.hasEmblem===true)try{
   const response=await read({action:'emblem',teamId:t.id}),image=response?.image,b64=image?.base64;
   if(image?.contentType==='image/webp'&&typeof b64==='string'&&b64.length>=16&&b64.length<=174764&&/^UklGR[A-Za-z0-9+/]*={0,2}$/.test(b64))info.team.emblemSource='data:image/webp;base64,'+b64;
  }catch(_){/* Keep the verified team identity if the image is unavailable. */}
  return info;
 }catch{return {state:'unavailable'};}
}
function render(info,esc){
 if(info?.state==='none')return '<p>尚未加入戰隊</p><button type="button" class="btn btn-ghost" data-action="card-team-lobby">前往戰隊大廳</button>';
 if(info?.state!=='team')return '';
 const t=info.team,frame=t.selectedFrame?' team-frame-'+t.selectedFrame:'';
 const image=typeof t.emblemSource==='string'&&t.emblemSource.length<=174787&&/^data:image\/webp;base64,UklGR[A-Za-z0-9+/]*={0,2}$/.test(t.emblemSource)?'<img src="'+esc(t.emblemSource)+'" alt="戰隊圖案" width="64" height="64" style="object-fit:contain;max-width:100%">':'';
 return '<div class="bxh-team-ui"><style>'+(root.BXHTeamUI?.css||'')+'</style><div class="team-identity'+frame+'">'+image+'<p>戰隊：'+esc(t.name)+'</p><p>'+esc(roles[t.role])+'｜LV '+esc(t.level)+'</p><button type="button" class="btn btn-ghost" data-action="card-team-open" data-team-id="'+esc(t.id)+'">查看戰隊</button></div></div>';
}
if(typeof module==='object'&&module.exports)module.exports={load,render};else root.BXHTeamCard={load,render};
})(typeof window==='object'?window:globalThis);
