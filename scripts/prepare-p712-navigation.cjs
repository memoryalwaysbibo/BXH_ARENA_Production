'use strict';
// One-time exact-marker migration, only on the isolated P7.12.1 branch.
const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2]||process.cwd(),file=path.join(root,'index.html');
let html=fs.readFileSync(file,'utf8');
function replaceOnce(from,to){if(html.split(from).length!==2)throw Error('Expected exactly one marker: '+from.slice(0,100));html=html.replace(from,to);}
function replaceFunction(name,body){const start=html.indexOf('function '+name+'('),end=html.indexOf('\n}',start)+2;if(start<0||end<=start)throw Error('Missing function '+name);replaceOnce(html.slice(start,end),body.trim());}
replaceFunction('normalizeGoogleMapsUrl',String.raw`
function normalizeGoogleMapsUrl(value){
  if(typeof value!=="string")return "";
  const raw=value.trim();
  if(!raw||raw.length>2048||/[\s\u0000-\u001f\u007f\\]/.test(raw)||/%(?:00|0a|0d)/i.test(raw))return "";
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.username||u.password||u.port)return "";
    const host=u.hostname.toLowerCase();
    if(host==="maps.app.goo.gl"&&/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))return u.href;
    if(host==="maps.google.com"&&(u.pathname==="/"||/^\/maps(?:\/|$)/.test(u.pathname)))return u.href;
    if(["www.google.com","google.com","www.google.com.tw","google.com.tw"].includes(host)&&/^\/maps(?:\/|$)/.test(u.pathname))return u.href;
  }catch(e){}
  return "";
}`);
replaceFunction('extractGoogleMapsUrlFromText',String.raw`
function extractGoogleMapsUrlsFromText(text){
  const source=String(text||"");
  const candidates=source.match(/https:\/\/[^\s<>"']+/ig)||[];
  const urls=[];
  for(const candidate of candidates){
    let raw=candidate.replace(/[\]}>，。！？、,;；]+$/g,"");
    while(raw.endsWith(")")&&(raw.match(/\)/g)||[]).length>(raw.match(/\(/g)||[]).length)raw=raw.slice(0,-1);
    const normalized=normalizeGoogleMapsUrl(raw);
    if(normalized&&!urls.includes(normalized))urls.push(normalized);
  }
  return urls;
}
function extractGoogleMapsUrlFromText(text){
  const urls=extractGoogleMapsUrlsFromText(text);
  return urls.length===1?urls[0]:"";
}`);
replaceFunction('googleMapsNavigationUrl',String.raw`
function googleMapsNavigationUrl(venue){
  const v=venue&&typeof venue==="object"?venue:{};
  const direct=normalizeGoogleMapsUrl(v.googleMapsUrl);
  if(direct)return direct;
  const address=String(v.address||"").trim();
  if(!address)return ""; // Do not guess a branch from its name alone.
  const url="https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(address);
  return url.length<=2048?url:"";
}`);
replaceFunction('appleMapsNavigationUrl',String.raw`
function appleMapsNavigationUrl(venue){
  const address=String(venue&&venue.address||"").trim();
  if(!address)return "";
  const url="https://maps.apple.com/?daddr="+encodeURIComponent(address);
  return url.length<=2048?url:"";
}`);
replaceFunction('applyVenueDraftToState',String.raw`
function applyVenueDraftToState(d,st=state){
  if(!st||!d)return;
  const info=normalizeEventInfoV2(st.eventInfo);
  const explicit=Object.prototype.hasOwnProperty.call(d,"venueName")||Object.prototype.hasOwnProperty.call(d,"venueAddress");
  const legacy=explicit?{name:"",address:""}:splitLegacyVenueText(d.location);
  const venue={
    name:String(explicit?(d.venueName||""):legacy.name).trim(),
    address:String(explicit?(d.venueAddress||""):legacy.address).trim(),
    googleMapsUrl:normalizeGoogleMapsUrl(d.googleMapsUrl),
    navigationEnabled:d.navigationEnabled===true,
    legacyText:""
  };
  venue.legacyText=buildLegacyVenueText(venue);
  if(!venue.address&&!venue.googleMapsUrl)venue.navigationEnabled=false;
  info.venue=venue;
  st.eventInfo=info;
  st.meta=st.meta||{};
  st.meta.location=venue.legacyText;
}`);
replaceFunction('publicVenueFromTournament',String.raw`
function venueForEventState(st){
  const m=st&&st.meta||{};
  const raw=st&&st.eventInfo&&st.eventInfo.venue||{};
  const text=String(m.location||"").trim();
  const structuredText=buildLegacyVenueText({name:raw.name,address:raw.address});
  const changed=text!==structuredText;
  const legacy=splitLegacyVenueText(text);
  const v={
    name:changed?legacy.name:String(raw.name||"").trim(),
    address:changed?legacy.address:String(raw.address||"").trim(),
    googleMapsUrl:changed?"":normalizeGoogleMapsUrl(raw.googleMapsUrl),
    navigationEnabled:!changed&&raw.navigationEnabled===true,
    legacyText:text
  };
  if(!v.address&&!v.googleMapsUrl)v.navigationEnabled=false;
  return v;
}
function publicVenueFromTournament(t){
  const pd=t&&t.parsedData||{};
  const raw=pd.eventInfo&&pd.eventInfo.venue;
  const legacyText=String(t&&t.location||pd.meta&&pd.meta.location||"");
  if(raw&&typeof raw==="object"){
    const location=Object.prototype.hasOwnProperty.call(t||{},"location")?String(t.location||""):buildLegacyVenueText(raw);
    return venueForEventState({meta:{location},eventInfo:{venue:raw}});
  }
  const legacy=splitLegacyVenueText(legacyText);
  return {name:legacy.name,address:legacy.address,googleMapsUrl:"",navigationEnabled:false};
}`);
replaceOnce('  const venue=splitLegacyVenueText(m.location);\n  info.basic.name=String(m.name||"");','  const venue=venueForEventState(st);\n  info.basic.name=String(m.name||"");');
replaceOnce('  if(String(m.location||"").trim()){\n    info.venue.name=venue.name;\n    info.venue.address=venue.address;\n    info.venue.legacyText=venue.legacyText;\n  }','  info.venue=venue;');
replaceOnce('  const venue=eventInfo.venue||{};\n  const venueName=String(venue.name||legacyVenue.name||"");\n  const venueAddress=String(venue.address||legacyVenue.address||"");','  const venue=venueForEventState(state);\n  const venueName=String(venue.name||"");\n  const venueAddress=String(venue.address||"");');
replaceOnce('settingsFormDraft.location=buildLegacyVenueText({name:settingsFormDraft.venueName,address:settingsFormDraft.venueAddress,legacyText:settingsFormDraft.location});','settingsFormDraft.location=buildLegacyVenueText({name:settingsFormDraft.venueName,address:settingsFormDraft.venueAddress});');
replaceOnce('  const venue=info.venue||{};\n  const safeGoogleMapsUrl=normalizeGoogleMapsUrl(venue.googleMapsUrl);','  const venue=venueForEventState(st);\n  const safeGoogleMapsUrl=normalizeGoogleMapsUrl(venue.googleMapsUrl);');
replaceOnce('navigationEnabled:venue.navigationEnabled===true && !!(safeGoogleMapsUrl||String(venue.address||venue.name||"").trim())','navigationEnabled:venue.navigationEnabled===true && !!(safeGoogleMapsUrl||String(venue.address||"").trim())');
replaceFunction('renderVenueNavigationMenu',String.raw`
function renderVenueNavigationMenu(venue){
  const v=venue&&typeof venue==="object"?venue:{};
  if(v.navigationEnabled!==true||(!googleMapsNavigationUrl(v)&&!appleMapsNavigationUrl(v)))return "";
  return '<button type="button" class="venue-nav-open" data-action="venue-navigation-open" aria-haspopup="dialog" aria-label="開啟場地導航與完整地址">🧭 導航</button>';
}
async function copyVenueAddress(address,dialog,status){
  let ok=false;
  try{
    if(!navigator.clipboard||!navigator.clipboard.writeText)throw Error("clipboard-unavailable");
    await navigator.clipboard.writeText(address);ok=true;
  }catch(e){
    const area=document.createElement("textarea");
    area.value=address;area.setAttribute("aria-label","可手動複製的地址");
    dialog.appendChild(area);area.select();
    try{ok=document.execCommand("copy")===true;}catch(ignore){}
    area.remove();
  }
  status.textContent=ok?"地址已複製":"無法自動複製，請長按上方完整地址手動複製。";
  return ok;
}
function openVenueNavigation(venue){
  const v=venue&&typeof venue==="object"?venue:{};
  if(v.navigationEnabled!==true)return;
  const google=googleMapsNavigationUrl(v),apple=appleMapsNavigationUrl(v);
  if(!google&&!apple)return;
  const prior=document.getElementById("bxh-venue-navigation-dialog");
  if(prior){if(typeof prior.close==="function"&&prior.open)prior.close();else prior.remove();}
  const opener=document.activeElement;
  const dialog=document.createElement("dialog");
  dialog.id="bxh-venue-navigation-dialog";
  dialog.className="venue-navigation-dialog";
  dialog.setAttribute("aria-labelledby","venue-navigation-title");
  const address=String(v.address||"").trim();
  dialog.innerHTML='<div class="venue-navigation-heading"><h2 id="venue-navigation-title">場地導航</h2><button type="button" data-venue-close aria-label="關閉導航">✕</button></div>'+
    '<strong class="venue-navigation-name">'+esc(v.name||"活動地點")+'</strong>'+
    (address?'<p class="venue-navigation-address">'+esc(address)+'</p>':'<p class="venue-navigation-note">未提供地址；僅開啟主辦提供的 Google Maps 連結。</p>')+
    '<div class="venue-navigation-links">'+
    (google?'<a href="'+esc(google)+'" target="_blank" rel="noopener noreferrer">Google Maps</a>':'')+
    (apple?'<a href="'+esc(apple)+'" target="_blank" rel="noopener noreferrer">Apple 地圖</a>':'')+
    (address?'<button type="button" data-venue-copy>複製地址</button>':'')+'</div>'+
    '<p class="venue-navigation-note">Google 優先使用主辦提供的地圖連結；Apple 依地址查詢。請在地圖確認目的地後開始導航。</p>'+
    '<p class="venue-navigation-status" role="status" aria-live="polite"></p>';
  document.body.appendChild(dialog);
  const close=()=>{if(typeof dialog.close==="function"&&dialog.open)dialog.close();else{dialog.remove();if(opener&&opener.isConnected)opener.focus();}};
  dialog.querySelector('[data-venue-close]').addEventListener('click',close);
  dialog.addEventListener('close',()=>{dialog.remove();if(opener&&opener.isConnected)opener.focus();},{once:true});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
  dialog.querySelector('[data-venue-copy]')?.addEventListener('click',()=>copyVenueAddress(address,dialog,dialog.querySelector('[role="status"]')));
  if(typeof dialog.showModal==="function")dialog.showModal();
  else{dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.classList.add('venue-navigation-fallback');}
  dialog.querySelector('[data-venue-close]').focus();
}`);
replaceOnce('function handleAction(action, target){','function handleAction(action, target){\n  if(action==="venue-navigation-open"){openVenueNavigation(publicVenueFromTournament(tournamentDetailData));return;}');
const css=String.raw`
/* P7.12.1: top-layer navigation avoids clipping inside fixed-height cards. */
.venue-nav-open{flex:0 0 auto;min-height:30px;padding:3px 7px;border:1px solid var(--gold-dim);border-radius:7px;background:var(--panel);color:var(--white);font-size:10px;font-weight:700;white-space:nowrap;cursor:pointer;}
.venue-nav-open:focus-visible{outline:2px solid var(--gold);outline-offset:2px;}
.venue-detail-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.venue-detail-address-row{flex-wrap:nowrap!important;min-width:0;gap:4px;}
.venue-detail-address{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.venue-navigation-dialog{width:min(420px,calc(100vw - 28px));max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;border:1px solid var(--gold-dim);border-radius:14px;padding:18px;background:var(--panel);color:var(--white);box-shadow:0 18px 60px rgba(0,0,0,.5);}
.venue-navigation-dialog::backdrop{background:rgba(0,0,0,.66);}
.venue-navigation-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;}
.venue-navigation-heading h2{margin:0;font-size:18px;}
.venue-navigation-heading button{min-width:44px;min-height:44px;border:0;background:transparent;color:inherit;font-size:18px;}
.venue-navigation-name{display:block;margin-top:12px;overflow-wrap:anywhere;}
.venue-navigation-address{font-size:14px;line-height:1.6;user-select:text;overflow-wrap:anywhere;}
.venue-navigation-links{display:grid;gap:8px;margin-top:14px;}
.venue-navigation-links a,.venue-navigation-links button{display:flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:44px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--panel-2);color:var(--white);font:inherit;text-decoration:none;}
.venue-navigation-note,.venue-navigation-status{font-size:12px;line-height:1.6;color:var(--metal);}
.venue-navigation-fallback{position:fixed;inset:10% auto auto 50%;transform:translateX(-50%);z-index:10000;}
`;
const styleEnd=html.indexOf('</style>');if(styleEnd<0)throw Error('Style boundary missing');html=html.slice(0,styleEnd)+css+html.slice(styleEnd);
replaceOnce('  const checkinCompatible=aiCreateHalfHourCompatible(event.checkInStart);','  const mapLinks=extractGoogleMapsUrlsFromText(aiCreateSourceText);\n  if(mapLinks.length>1)warnings.push("原文包含多個地圖連結，未自動選擇；請房主確認本場場地連結。");\n  const checkinCompatible=aiCreateHalfHourCompatible(event.checkInStart);');
replaceOnce('googleMapsUrl:extractGoogleMapsUrlFromText(aiCreateSourceText),','googleMapsUrl:mapLinks.length===1?mapLinks[0]:"",');
replaceOnce('navigationEnabled:!!(String(activity.address||"").trim()||extractGoogleMapsUrlFromText(aiCreateSourceText)),','navigationEnabled:!!(String(activity.address||"").trim()||mapLinks.length===1),');
replaceOnce('const APP_VERSION = "v14.2.24";','const APP_VERSION = "v14.2.25";');
replaceOnce('<meta name="bxh-build" content="20260925.35">','<meta name="bxh-build" content="20260925.36">');
replaceOnce('var CURRENT_BUILD="20260925.35";','var CURRENT_BUILD="20260925.36";');
const entry={version:'v14.2.25',date:'2026/09/25',timezone:'Asia/Taipei',title:'P7.12.1 導航防呆與複製地址',updateLevel:'patch',added:['導航視窗新增完整地址與複製地址','多個地圖連結需房主確認，不自動選擇'],changed:['Google 保留主辦提供的連結；Apple 僅依地址建立路線','只有店名時不推測目的地；導航視窗獨立於資訊卡，避免手機裁切'],fixed:['修正清空場地後舊地址回填','修正僅填地址時被存成店名','加強 Maps URL 主機、路徑與安全格式檢查'],environment:'Production / Event Info V2',deployStatus:'P7.12.1 navigation hardening',firebaseImpact:'沿用 eventInfo.venue；無資料移轉或新增集合',securityRulesImpact:'無',permissionImpact:'無',publicSummary:'場地導航可查看並複製完整地址；清空地址不再恢復舊值，缺地址不會自動導航到同名店家。'};
replaceOnce('const VERSION_HISTORY = [\n','const VERSION_HISTORY = [\n  '+JSON.stringify(entry)+',\n');
const versionPath=path.join(root,'version.json'),version=JSON.parse(fs.readFileSync(versionPath,'utf8'));
if(version.build!=='20260925.35'||version.version!=='v14.2.24')throw Error('Base version changed; refuse overwrite');
const vm=require('node:vm');let n=0;
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc\s*=/.test(m[1])||/type=["'](?:application\/ld\+json|importmap)["']/.test(m[1]))continue;new vm.Script(m[2],{filename:'inline-'+(++n)});}
const workflowPath=path.join(root,'.github/workflows/validate-production-frontend.yml');
let workflow=fs.readFileSync(workflowPath,'utf8');
const step='      - name: Verify Production frontend invariants\n';
if(workflow.split(step).length!==2)throw Error('CI marker changed');
workflow=workflow.replace(step,'      - name: Verify venue navigation regressions\n        run: node tests/venue-navigation.test.cjs\n'+step);
fs.writeFileSync(file,html);
fs.writeFileSync(versionPath,JSON.stringify({...version,build:'20260925.36',version:'v14.2.25',updatedAt:new Date().toISOString()},null,2)+'\n');
fs.writeFileSync(workflowPath,workflow);
console.log('Prepared P7.12.1; '+n+' inline scripts parsed.');
