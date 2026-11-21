'use strict';
const names=['百戰磨練','雙生修羅','三途橫渡','四神俱滅','五嶽崩摧','六道輪迴','七星隕落','八荒血帝','九天終焉','千古不滅'];
const DEFINITIONS=Object.freeze(names.map((name,i)=>Object.freeze({id:i===0?'hundred_battles':`battles_${(i+1)*100}`,code:i===0?'HUNDRED_BATTLES':`BATTLES_${(i+1)*100}`,name,targetValue:(i+1)*100,conditionType:'official_matches',description:`累積完成${(i+1)*100}場 BXH 官方積分賽對戰。每次與對手完成一場對局計1場。`,hint:'僅計入可核對帳號的已完成正式對戰；輪空、取消、未到、測試對戰不計。',category:'participation',rarity:'epic',rarityTier:'epic',limitedType:'none',isLimited:false,isPermanent:true,isActive:true,isPublic:true,isHidden:false,isArchived:false,retroactiveEnabled:true,maxRecipients:0,seriesId:'official_match_milestones',sortOrder:2100+i})));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function accountUid(p){
 if(!p||p.familyPlayerId||p.isTestData===true||p.testMode===true)return null;
 const values=[...new Set(['accountUid','playerUid','uid','registrationUid'].map(k=>p[k]).filter(id))];
 return values.length===1?values[0]:null;
}
function matchEvidence({uid,state,registration}){
 if(!id(uid)||!state||!Array.isArray(state.players)||!Array.isArray(state.matches)||state.testMode===true||state.eventCancelled===true)return [];
 const reg=registration;
 const validReg=reg&&!reg.familyPlayerId&&reg.status!=='cancelled'&&reg.isTestData!==true&&reg.testMode!==true&&(!reg.uid||reg.uid===uid);
 const regIds=new Set(validReg?[reg.localPlayerId,reg.playerId,reg.participantId,reg.registrationId,reg.id,uid,'reg_'+uid].filter(id):[]);
 const own=new Set(state.players.filter(p=>{
  if(!p||p.familyPlayerId||p.isTestData===true||p.testMode===true)return false;
  const links=['accountUid','playerUid','uid','registrationUid'].map(k=>p[k]).filter(id);
  return links.length?accountUid(p)===uid:regIds.has(p.id);
 }).map(p=>p.id));
 const players=new Map();for(const p of state.players){if(!p||!id(p.id))continue;players.set(p.id,players.has(p.id)?null:p);}
 const seen=new Map();for(const m of state.matches){if(!m||!id(m.id))continue;seen.set(m.id,seen.has(m.id)?null:m);}
 const proof=[];
 for(const [key,m] of seen){
  if(!m||m.completed!==true||m.isBye||m.cancelled||m.isCancelled||m.voided||m.isTestData||m.testMode||m.forfeit||m.walkover||m.disqualified||m.noShow||m.isForfeit)continue;
  if(/forfeit|walkover|no.?show|disqual|cancel|void/i.test(String(m.resultMethod||'')))continue;
  const a=m.a?.playerId,b=m.b?.playerId;
  if(!id(a)||!id(b)||a===b||!players.get(a)||!players.get(b)||![a,b].includes(m.winnerId))continue;
  if(Number(own.has(a))+Number(own.has(b))!==1)continue;
  proof.push(key);
 }
 return proof.sort();
}
function countOfficialMatches(input){return matchEvidence(input).length;}
module.exports={DEFINITIONS,accountUid,matchEvidence,countOfficialMatches};
