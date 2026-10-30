'use strict';
const MINUTE=60000, HOUR=60*MINUTE, MAX_HEARTBEAT_GAP_MS=120000;
const DEFINITIONS=Object.freeze([
  [1,'微光初現','common'],[10,'星光漸明','common'],[50,'流光刻痕','rare'],
  [100,'百時星軌','rare'],[500,'歲月銘刻','epic'],[1000,'千載流光','legendary']
].map(([hours,name,tier])=>Object.freeze({
  id:`online_time_${hours}h`,code:`ONLINE_TIME_${hours}H`,name,
  description:`累積有效在線 ${hours.toLocaleString('en-US')} 小時。`,
  hint:'沿用在線心跳紀錄；跨日累積，無每日時數上限，與活躍積分上限分開。',
  category:'activity',source:'在線時間',conditionType:'total_online_minutes',targetValue:hours*60,
  rarity:tier,rarityTier:tier,limitedType:'none',isLimited:false,isPermanent:true,
  isPublic:true,isActive:true,isHidden:false,isArchived:false,retroactiveEnabled:false,
  artwork:`assets/title-${tier}-online-time-${hours}h-v1.webp`
})));
function integer(value,label){
  if(!Number.isSafeInteger(value)||value<0)throw Error('invalid-'+label);
  return value;
}
function milliseconds(value){
  const n=value&&typeof value.toMillis==='function'?value.toMillis():value;
  return Number.isSafeInteger(n)&&n>0?n:0;
}
function eligible(profile){
  return !!profile&&profile.active===true&&profile.deleted!==true&&profile.isTestAccount!==true&&
    profile.role!=='tester'&&!['frozen','disabled','deleted'].includes(profile.accountStatus);
}
// A short source interval is credited once. Long offline gaps are rejected, not
// truncated into fictitious time. This is a continuity check, not a daily cap.
function interval(before,after,startAt){
  const start=milliseconds(before?.lastSeenAt),end=milliseconds(after?.lastSeenAt);
  if(!start||!end||end<=start||end-start>MAX_HEARTBEAT_GAP_MS)return null;
  const from=Math.max(start,integer(startAt,'start-at'));
  return from<end?{start:from,end,deltaMs:end-from}:null;
}
function totalAfter(old,delta){
  const result=integer(old??0,'stored-total')+integer(delta,'delta');
  return integer(result,'total');
}
function matchesDefinition(row,expected){
  return row&&['name','conditionType','targetValue','rarityTier','limitedType','isLimited','isPermanent']
    .every(key=>row[key]===expected[key]);
}
module.exports={MINUTE,HOUR,MAX_HEARTBEAT_GAP_MS,DEFINITIONS,integer,milliseconds,eligible,interval,totalAfter,matchesDefinition};
