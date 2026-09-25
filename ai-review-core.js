/* P7.11C: pure proposals. No network or room writes; unknown deadlines remain unknown. */
(function(root,factory){
  'use strict';const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BxhAiReview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TIME=/^([01]\d|2[0-3]):([0-5]\d)$/;
  const KEYS={settings:['date','startTime','checkin','checkinRequired'],registration:['registrationEnabled','registrationOpenAt','registrationCloseAt','registrationCapacity','registrationFee']};
  const labels={startTime:'開賽時間',checkin:'開始報到',checkinRequired:'報到要求',registrationOpenAt:'報名開放',registrationCloseAt:'報名截止',registrationCapacity:'正取名額',registrationFee:'報名費'};
  const empty=v=>v==null||v==='';
  const minutes=v=>TIME.test(String(v||''))?Number(v.slice(0,2))*60+Number(v.slice(3)):null;
  function epoch(v){
    if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::00)?\+08:00$/.test(v))return null;
    const ms=Date.parse(v);if(!Number.isFinite(ms))return null;
    return new Date(ms+8*3600000).toISOString().slice(0,16)===v.slice(0,16)?ms:null;
  }
  function signature(settings,registration){return JSON.stringify(Object.entries(KEYS).map(([scope,keys])=>keys.map(k=>((scope==='settings'?settings:registration)||{})[k]??null)));}
  function display(field,value){
    if(empty(value))return '未填';
    if(field==='checkinRequired')return value?'需要報到':'免報到';
    if(field==='registrationOpenAt'||field==='registrationCloseAt')return Number.isFinite(value)?new Date(value+8*3600000).toISOString().slice(0,16).replace('T',' '):'格式待確認';
    if(field==='registrationCapacity')return String(value)+' 人';if(field==='registrationFee')return 'NT$'+String(value);return String(value);
  }
  function build(settings={},registration={},event={},activity={},warnings=[]){
    const list=[];
    const conflict=field=>warnings.some(w=>w&&/conflict|contradic|mismatch/i.test(w.code||'')&&(!w.field||String(w.field).endsWith('.'+field)||w.field===field));
    const scheduleConflict=conflict('date');
    const change=(scope,field,to)=>({scope,field,from:(scope==='settings'?settings:registration)[field]??null,to});
    const add=(id,title,origin,message,changes)=>list.push({id,title,origin,message,changes,defaultSelected:origin==='source'});
    const start=minutes(event.startAt),checkin=minutes(event.checkInStart),end=minutes(event.checkInEnd),currentStart=minutes(settings.startTime),currentCheckin=minutes(settings.checkin);
    if(empty(settings.startTime)&&!scheduleConflict&&!conflict('startAt')){
      if(start!=null)add('start-from-source','補上開賽時間','source','原文明確辨識到開賽時間；保留分鐘，不四捨五入。',[change('settings','startTime',event.startAt)]);
      else if(empty(event.startAt)&&end!=null&&!conflict('checkInEnd'))add('start-from-checkin-end','報到結束後開賽','recommended','原文未提供開賽時間。可考慮在報到結束後開賽，請確認現場流程；此項不預先勾選。',[change('settings','startTime',event.checkInEnd)]);
    }
    if(empty(settings.checkin)&&!scheduleConflict&&!conflict('checkInStart')){
      if(checkin!=null)add('checkin-from-source','補上開始報到時間','source','原文明確辨識到報到流程，確認後同時開啟需要報到。',[change('settings','checkin',event.checkInStart),...(settings.checkinRequired?[]:[change('settings','checkinRequired',true)])]);
      else if(empty(event.checkInStart)&&currentStart!=null&&currentStart>=30&&!conflict('startAt')){
        const total=currentStart-30,v=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
        add('checkin-default-30','開賽前 30 分鐘開始報到','recommended','原文未提供報到時間；依目前草稿的開賽時間提出建議，不代表原文內容。',[change('settings','checkin',v),...(settings.checkinRequired?[]:[change('settings','checkinRequired',true)])]);
      }
    }
    if(!settings.checkinRequired&&currentCheckin!=null&&!scheduleConflict&&!conflict('checkInStart'))add('enable-checkin','開啟「需要報到」',checkin!=null?'source':'recommended','目前草稿已有報到時間，但報到要求尚未開啟。',[change('settings','checkinRequired',true)]);
    if(registration.registrationEnabled){
      for(const [field,id,title] of [['registrationOpenAt','registration-open-from-source','補上報名開放時間'],['registrationCloseAt','registration-close-from-source','補上報名截止時間']]){
        const ms=epoch(activity[field]);if(empty(registration[field])&&ms!=null&&!conflict(field))add(id,title,'source','使用原文明確提供的日期與時間，保留原始分鐘。',[change('registration',field,ms)]);
      }
      if(empty(registration.registrationCapacity)&&Number.isInteger(event.capacity)&&event.capacity>0&&!conflict('capacity'))add('capacity-from-source','補上正取名額','source','使用原文辨識的參賽人數。',[change('registration','registrationCapacity',event.capacity)]);
    }
    if(empty(registration.registrationFee)&&typeof event.fee==='number'&&Number.isFinite(event.fee)&&event.fee>=0&&!conflict('fee'))add('fee-from-source','補上報名費','source','使用原文辨識的費用；零元也屬有效資料。',[change('registration','registrationFee',event.fee)]);
    return list;
  }
  function apply(settings,registration,review,selectedIds){
    if(!review||signature(settings,registration)!==review.signature)return {ok:false,reason:'stale',count:0};
    const selected=review.list.filter(s=>selectedIds.includes(s.id));if(!selected.length)return {ok:false,reason:'empty',count:0};
    const next={settings:{...settings},registration:{...registration}},seen=new Map();
    for(const proposal of selected)for(const c of proposal.changes){
      if(!KEYS[c.scope]||!KEYS[c.scope].includes(c.field)||c.field==='date'||c.field==='registrationEnabled')return {ok:false,reason:'invalid',count:0};
      const old=(c.scope==='settings'?settings:registration)[c.field]??null;
      if(old!==c.from||(!empty(old)&&!(c.field==='checkinRequired'&&old===false)))return {ok:false,reason:'stale',count:0};
      const valid=c.field==='checkinRequired'?c.to===true:['checkin','startTime'].includes(c.field)?minutes(c.to)!=null:c.field==='registrationCapacity'?Number.isInteger(c.to)&&c.to>0:typeof c.to==='number'&&Number.isFinite(c.to)&&c.to>=0;
      if(!valid)return {ok:false,reason:'invalid',count:0};const key=c.scope+'.'+c.field;
      if(seen.has(key)&&seen.get(key)!==c.to)return {ok:false,reason:'conflict',count:0};seen.set(key,c.to);next[c.scope][c.field]=c.to;
    }
    const st=minutes(next.settings.startTime),ci=minutes(next.settings.checkin);if(st!=null&&ci!=null&&ci>st)return {ok:false,reason:'time-order',count:0};
    const r=next.registration;if(r.registrationEnabled&&!empty(r.registrationOpenAt)&&!empty(r.registrationCloseAt)&&r.registrationCloseAt<=r.registrationOpenAt)return {ok:false,reason:'registration-order',count:0};
    return {ok:true,count:selected.length,settings:next.settings,registration:next.registration};
  }
  return Object.freeze({build,apply,signature,display,labels,minutes,epoch});
});
