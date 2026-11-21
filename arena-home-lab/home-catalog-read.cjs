'use strict';
const {projectPublicCard}=require('./home-publisher.cjs');
// Isolated read contract. Caller supplies one current, already-authorized
// generation. No database write, live route, or lifecycle repair dependency.
const norm=v=>String(typeof v==='string'?v:'').trim().toLowerCase();
const classes=new Set(['live','upcoming','settling','ended','all']);
const classOf=c=>c.eventPhase==='live'||c.eventPhase==='settling'?c.eventPhase:
 c.eventPhase==='done'||c.eventPhase==='cancelled'?'ended':'upcoming';
function readCatalogPage(generation,{category='all',filters={},cursor=null,limit=20}={}){
 if(!Number.isSafeInteger(generation?.version)||generation.version<0||!Array.isArray(generation.cards))throw Error('catalog-generation');
 if(!classes.has(category)||!Number.isSafeInteger(limit)||limit<1||limit>20)throw Error('catalog-request');
 const keyword=norm(filters.keyword),region=norm(filters.region),date=norm(filters.date),format=norm(filters.format||'all');
 if(keyword.length>120||region.length>120||(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))||!['all','single','double','roundrobin'].includes(format))throw Error('catalog-filters');
 const key=JSON.stringify([category,keyword,region,date,format]);
 if(cursor&&(cursor.version!==generation.version||cursor.key!==key))return {kind:'restart',version:generation.version};
 // Generation construction must already omit private/deleted source rows;
 // projection here bounds output fields again, never forwarding documents.
 const rows=generation.cards.map(c=>projectPublicCard({...c,visibility:c.visibility??'public'})).filter(Boolean)
  .filter(c=>category==='all'||classOf(c)===category)
  .filter(c=>(!keyword||[c.title,c.hostName,c.location,c.id].some(s=>norm(s).includes(keyword)))&&
   (!region||norm(c.location).includes(region))&&(!date||c.eventDate===date)&&
   (format==='all'||(c.formatType||'single')===format))
  .sort((a,b)=>{
   const ak=Number.isFinite(a.eventAt),bk=Number.isFinite(b.eventAt);
   return ak!==bk?(ak?-1:1):ak&&a.eventAt!==b.eventAt?b.eventAt-a.eventAt:a.id.localeCompare(b.id);
  });
 if(new Set(rows.map(c=>c.id)).size!==rows.length)throw Error('catalog-duplicate');
 const before=cursor?rows.findIndex(c=>c.id===cursor.after):-1;
 if(cursor&&before<0)return {kind:'restart',version:generation.version};
 const start=before+1,cards=rows.slice(start,start+limit);
 return {kind:'page',version:generation.version,cards,
  next:start+cards.length<rows.length?{version:generation.version,key,after:cards.at(-1).id}:null};
}
module.exports={readCatalogPage};
