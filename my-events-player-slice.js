(function(root){
const modules={
'./ui-state.js':function(module,exports,require){
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MyEventsMembershipUI=api;})(globalThis,()=>{
 'use strict';
 const SCOPE_TITLE='我的個人／家庭報名',SCOPE_NOTICE='不包含團體賽與抽籤中的賽事；資料同步可能有短暫延遲，請使用原有專用入口查看其他賽事。',EMPTY_TEXT='目前已同步的個人／家庭報名中，沒有進行中的賽事。';
 const copy=x=>JSON.parse(JSON.stringify(x)),dense=a=>Array.isArray(a)&&Array.from({length:a.length},(_,i)=>Object.hasOwn(a,i)).every(Boolean);
 const set=(a,allowed)=>dense(a)&&a.length>0&&a.every((x,i)=>allowed.includes(x)&&(i===0||a[i-1]<x));
 const card=c=>c&&typeof c.code==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(c.code)&&['waiting','live','settling'].includes(c.phase)&&set(c.participantKinds,['family','self'])&&set(c.registrationStatuses,['confirmed','waitlist']);
 const clean=c=>({code:c.code,phase:c.phase,participantKinds:[...c.participantKinds],registrationStatuses:[...c.registrationStatuses]});
 function valid(r){
  if(r?.schemaVersion!==24||r.scope!=='individual-family'||!dense(r.cards)||r.cards.length>16||!r.cards.every(card)||new Set(r.cards.map(c=>c.code)).size!==r.cards.length||!dense(r.notices)||r.notices.some(n=>!['restore-synchronizing','known-owner-failure','own-membership-error','room-unavailable','unsupported-scope','membership-unresolved'].includes(n))||typeof r.complete!=='boolean'||typeof r.confirmedEmpty!=='boolean'||!(r.nextCursor===null||typeof r.nextCursor==='string'&&r.nextCursor.length>0))return false;
  if(r.status==='unknown')return !r.complete&&!r.confirmedEmpty&&!r.cards.length&&r.nextCursor===null;
  if(!['ready','continue','synchronizing'].includes(r.status)||r.complete!==(r.nextCursor===null))return false;
  if(r.confirmedEmpty&&(!r.complete||r.cards.length||r.notices.length||r.status!=='ready'))return false;
  if(r.status==='continue'&&(r.complete||r.cards.length))return false;
  if(r.status==='synchronizing'&&(r.cards.length||!r.notices.length))return false;
  return true;
 }
 function createStateAdapter({read,timeoutMs=10000}={}){
  if(typeof read!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>2147483647)throw Error('invalid-ui-dependencies');
  let uid=null,generation=0,active=null,disposed=false;
  const initial=()=>({status:'idle',cards:[],complete:false,confirmedEmpty:false,nextCursor:null,notices:[],loadingMore:false,reason:null,scopeTitle:SCOPE_TITLE,scopeNotice:SCOPE_NOTICE,emptyText:null});
  let state=initial();const snapshot=()=>copy(state);
  function cancel(){generation++;if(active){clearTimeout(active.timer);active.resolve({applied:false,reason:'superseded'});active=null;}}
  function setAccount(next){if(disposed)throw Error('disposed');cancel();uid=typeof next==='string'&&/^[^\s/]{1,128}$/.test(next)?next:null;state=initial();return snapshot();}
  function fetchPage(more){
   if(disposed)throw Error('disposed');if(more&&(!state.nextCursor||active))return Promise.resolve({applied:false,reason:'no-next-page'});
   const previous=more?snapshot():initial(),cursor=more?state.nextCursor:null;cancel();const run=generation,account=uid;
   state={...previous,status:more?'loading-more':'loading',confirmedEmpty:false,emptyText:null,loadingMore:more,reason:null};
   if(!account){state={...initial(),status:'unknown',reason:'unauthenticated'};return Promise.resolve({applied:true,state:snapshot()});}
   return new Promise(resolve=>{
    const current=()=>!disposed&&active?.run===run&&generation===run&&uid===account;
    function finish(r,error){if(!current())return;clearTimeout(active.timer);active=null;
     if(error||!valid(r)||r.status==='unknown')state={...previous,status:'unknown',confirmedEmpty:false,emptyText:null,loadingMore:false,reason:error||(!valid(r)?'invalid-response':r.reason||'unavailable')};
     else if(more&&r.nextCursor===cursor)state={...previous,status:'unknown',confirmedEmpty:false,loadingMore:false,reason:'cursor-did-not-advance'};
     else{
      const merged=new Map(previous.cards.map(c=>[c.code,c]));for(const c of r.cards)merged.set(c.code,clean(c));const cards=[...merged.values()];
      const notices=[...new Set([...previous.notices,...r.notices])];
      // Only this locally accumulated traversal can infer scoped empty after continuation.
      const empty=r.complete&&cards.length===0&&notices.length===0;
      state={...initial(),status:cards.length?'ready':empty?'empty':r.nextCursor?'continue':'synchronizing',cards,complete:r.complete,confirmedEmpty:empty,nextCursor:r.nextCursor,notices,emptyText:empty?EMPTY_TEXT:null};
     }
     resolve({applied:true,state:snapshot()});
    }
    active={run,resolve,timer:setTimeout(()=>finish(null,'timeout'),timeoutMs)};
    Promise.resolve().then(()=>current()?read(cursor):null).then(r=>finish(r,null)).catch(()=>finish(null,'rpc-error'));
   });
  }
  function dispose(){cancel();uid=null;disposed=true;state=initial();}
  return Object.freeze({setAccount,refresh:()=>fetchPage(false),loadMore:()=>fetchPage(true),snapshot,dispose});
 }
 return {createStateAdapter,valid,SCOPE_TITLE,SCOPE_NOTICE,EMPTY_TEXT};
});

},
'./detail-contract.cjs':function(module,exports,require){
'use strict';
function validMyActiveDetailResponse(r,code){
  const stamp=t=>t&&Number.isSafeInteger(t.seconds)&&Number.isInteger(t.nanoseconds)&&t.nanoseconds>=0&&t.nanoseconds<1e9;
  return r?.schemaVersion===1&&r.scope==='individual-family'&&['ready','continue','synchronizing','unknown','inactive'].includes(r.status)&&Array.isArray(r.rows)&&r.rows.length<=17&&r.rows.every(x=>x&&x.tournamentCode===code&&typeof x.registrationId==='string'&&x.uid===x.registrationId&&typeof x.displayName==='string'&&['confirmed','waitlist'].includes(x.status))&&Array.isArray(r.notices)&&r.notices.every(x=>typeof x==='string')&&typeof r.hasMore==='boolean'&&(r.hasMore?typeof r.nextCursor==='string'&&r.nextCursor.length>0:r.nextCursor===null)&&(!r.rows.length||stamp(r.roomIncarnation)&&stamp(r.roomUpdateTime));
}
module.exports={validMyActiveDetailResponse};

},
'./read-entry.cjs':function(module,exports,require){
'use strict';
// Local integration candidate, not installed in production core/bootstrap.
// Reuses the existing v26 UI state adapter and v28 detail validator unchanged.
const {createStateAdapter}=require('./ui-state.js');
const {validMyActiveDetailResponse}=require('./detail-contract.cjs');
function createReadEntry({call,summary,cooldown=()=>new Promise(r=>setTimeout(r,1100)),timeoutMs=10000}={}){
 if(typeof call!=='function'||typeof summary!=='function')throw Error('authenticated-transport-required');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>2147483647)throw Error('invalid-timeout');
 let epoch=0,account=null,listFlight=null,tail=Promise.resolve();const details=new Map();
 const adapter=createStateAdapter({read:cursor=>call('queryMyActiveEvents',cursor===null?{}:{cursor})});
 const current=(generation,owner)=>generation===epoch&&owner===account;
 function setAccount(uid){const next=uid||null;if(account===next)return;epoch++;account=next;listFlight=null;tail=Promise.resolve();details.clear();adapter.setAccount(account);}
 function bounded(work){let timer;return Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('read-timeout')),timeoutMs);})]).finally(()=>clearTimeout(timer));}
 function snapshot(){return {membership:adapter.snapshot(),rooms:adapter.snapshot().cards.map(card=>{
  const entry=details.get(card.code);return {card,status:entry?.status||'unloaded',rows:entry?.rows||[],info:entry?.info||null,notices:entry?.notices||[],nextCursor:entry?.nextCursor||null};
 }).map(room=>JSON.parse(JSON.stringify(room)))};}
 function load(more=false,refresh=false){
  if(listFlight)return listFlight;
  if(!more&&!refresh&&adapter.snapshot().status!=='idle')return Promise.resolve({applied:false,reason:'cached'});
  if(!more){epoch++;details.clear();}
  const generation=epoch,owner=account;
  const pending=more?adapter.loadMore():adapter.refresh();
  const flight=Promise.resolve(pending).finally(()=>{if(current(generation,owner)&&listFlight===flight)listFlight=null;});
  listFlight=flight;return flight;
 }
 function refreshSummary(code){
  const entry=details.get(code);
  if(!account||!adapter.snapshot().cards.some(card=>card.code===code)||!entry||entry.status!=='ready'||!entry.info||!entry.rows.length)return Promise.resolve({applied:false,reason:'details-not-ready'});
  if(entry.summaryFlight)return entry.summaryFlight;
  const generation=epoch,owner=account;
  const valid=()=>current(generation,owner)&&details.get(code)===entry;
  const work=bounded(()=>valid()?summary(code):null).then(info=>{
   if(!valid())return {applied:false,reason:'superseded'};
   if(!info)throw Error('summary-unconfirmed');
   entry.info=info;return {applied:true};
  }).catch(()=>{if(valid())entry.info={...entry.info,queueSyncFailed:true};return {applied:false,reason:'summary-unconfirmed'};});
  const flight=work.finally(()=>{if(valid()&&entry.summaryFlight===flight)entry.summaryFlight=null;});entry.summaryFlight=flight;return flight;
 }
 function loadDetails(code,more=false){
  // Arbitrary room identifiers cannot cause a read. Membership is mandatory.
  const member=adapter.snapshot().cards.find(card=>card.code===code);
  if(!account||!member)return Promise.resolve({applied:false,reason:'membership-not-confirmed'});
  let entry=details.get(code);if(entry?.flight)return entry.flight;
  if(more&&!entry?.nextCursor)return Promise.resolve({applied:false,reason:'no-next-page'});
  if(!more&&(entry?.status==='ready'||(entry?.status==='continue'&&entry.nextCursor)))return Promise.resolve({applied:false,reason:'cached'});
  if(!entry){entry={status:'loading',rows:[],info:null,notices:[],nextCursor:null,incarnation:null,flight:null};details.set(code,entry);}
  const generation=epoch,owner=account,cursor=more?entry.nextCursor:null;
  const valid=()=>current(generation,owner)&&details.get(code)===entry;
  entry.status='loading';
  const work=tail.then(async()=>{
   if(!valid())return {applied:false,reason:'superseded'};
   try{
    // No UID in payload: the server must obtain it from verified callable Auth.
    const response=await bounded(()=>valid()?call('queryMyActiveEventDetails',cursor===null?{code}:{code,cursor}):null);
    if(!valid())return {applied:false,reason:'superseded'};
    if(!validMyActiveDetailResponse(response,code))throw Error('invalid-response');
    if(['unknown','inactive'].includes(response.status)){entry.status=response.status;entry.rows=[];entry.nextCursor=null;return {applied:true};}
    const incarnation=JSON.stringify(response.roomIncarnation||null);
    if(cursor&&(response.nextCursor===cursor||entry.incarnation!==incarnation))throw Error('invalid-continuation');
    if(!response.rows.length&&!entry.rows.length){
     entry.status=response.status==='ready'?'synchronizing':response.status;entry.notices=[...new Set([...response.notices,'details-unconfirmed'])];entry.nextCursor=response.nextCursor;entry.incarnation=incarnation;return {applied:true};
    }
    // Only a listed and canonically validated room can reach this point-read.
    // No public collection enumeration or legacy fallback dependency exists.
    const info=entry.info||await bounded(()=>valid()?summary(code):null);
    if(!valid())return {applied:false,reason:'superseded'};
    if(!info)throw Error('summary-unconfirmed');
    const rows=new Map((more?entry.rows:[]).map(r=>[r.registrationId,r]));for(const row of response.rows)rows.set(row.registrationId,row);
    entry.rows=[...rows.values()];entry.info=info;entry.incarnation=incarnation;entry.status=response.status;
    entry.notices=[...new Set([...(more?entry.notices:[]),...response.notices])];entry.nextCursor=response.nextCursor;
    // Empty details never imply an empty membership list.
    if(!entry.rows.length&&!entry.notices.includes('details-unconfirmed'))entry.notices.push('details-unconfirmed');
    return {applied:true};
   }catch{if(valid()){entry.status='unknown';entry.nextCursor=null;}return {applied:false,reason:'unconfirmed'};}
  });
  tail=work.then(cooldown,cooldown).catch(()=>{});
  const flight=work.finally(()=>{if(valid()&&entry.flight===flight)entry.flight=null;});entry.flight=flight;return flight;
 }
 return Object.freeze({setAccount,load,refresh:()=>load(false,true),loadDetails,refreshSummary,snapshot});
}
module.exports={createReadEntry};

},
'./operation-ledger.js':function(module,exports,require){
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MyEventsOperationLedger=api;})(globalThis,()=>{
 'use strict';
 const PREFIX='bxh:my-events:operation:v25:';
 const TOKEN_PREFIX='bxh:my-events:invalidation:v25:';
 const routes=['family','roster'];
 const text=x=>typeof x==='string'&&x.length>0&&x.length<=128&&!/[\s/]/.test(x);
 const valid=r=>r&&r.version===25&&text(r.authUid)&&routes.includes(r.route)&&typeof r.operationId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(r.operationId)&&typeof r.code==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(r.code)&&['pending','settled'].includes(r.state);
 const key=r=>PREFIX+encodeURIComponent(r.authUid)+':'+encodeURIComponent(r.route)+':'+encodeURIComponent(r.operationId);
 const terminal=r=>key(r)+':settled';
 const clone=x=>JSON.parse(JSON.stringify(x));
 function createLedger({storage,queryStatus,uuid=()=>crypto.randomUUID(),onSettling=()=>{},onChange=()=>{},schedule=setTimeout,unschedule=clearTimeout,now=()=>Date.now(),visible=()=>true,maxAttempts=6,timeoutMs=10000,retrySync=null}={}){
  if(!storage||typeof queryStatus!=='function'||!Number.isInteger(maxAttempts)||maxAttempts<1)throw Error('invalid-ledger-dependencies');
  let uid=null,epoch=0,disposed=false,timer=null,busy=false,storageError=false,seenToken=null;
  const attempts=new Map(),due=new Map(),retries=new Map(),statuses=new Map(),reasons=new Map(),observedTerminals=new Set();
  function observeTerminal(r){const k=terminal(r);if(observedTerminals.has(k))return;observedTerminals.add(k);try{onSettling(clone(r));}catch(e){observedTerminals.delete(k);throw e;}}
  const tokenKey=()=>TOKEN_PREFIX+encodeURIComponent(uid);
  function observeToken(){const value=storage.getItem(tokenKey());if(value===seenToken)return;const previous=seenToken;seenToken=value;try{onSettling({authUid:uid,reason:'cross-tab-invalidation'});}catch(e){seenToken=previous;throw e;}}
  function collectSettled(r){
   observeTerminal(r);
   // Fixed-size local cache invalidation only, never evidence of server state.
   const value=uuid();storage.setItem(tokenKey(),value);if(storage.getItem(tokenKey())!==value)throw Error('invalidation-token-not-durable');seenToken=value;
   storage.removeItem(key(r));storage.removeItem(terminal(r));observedTerminals.delete(terminal(r));retries.delete(key(r));attempts.delete(key(r));due.delete(key(r));statuses.delete(key(r));reasons.delete(key(r));
  }
  function scan(){
   const pending=[];let corrupt=0;storageError=false;
   if(!uid)return {pending,corrupt,storageError};
   try{observeToken();const prefix=PREFIX+encodeURIComponent(uid)+':',keys=[];for(let i=0;i<storage.length;i++)keys.push(storage.key(i));for(const k of keys){
    if(!k?.startsWith(prefix))continue;let r;const raw=storage.getItem(k);if(raw===null)continue;try{r=JSON.parse(raw);}catch{corrupt++;continue;}
    if(!valid(r)||r.authUid!==uid||(key(r)!==k&&terminal(r)!==k)){corrupt++;continue;}
    if(k===terminal(r)){if(r.state!=='settled')corrupt++;else collectSettled(r);continue;}
    const done=storage.getItem(terminal(r));if(done!==null){let end;try{end=JSON.parse(done);}catch{corrupt++;continue;}if(!valid(end)||end.state!=='settled'||end.authUid!==r.authUid||end.route!==r.route||end.operationId!==r.operationId||end.code!==r.code)corrupt++;else collectSettled(end);continue;}
    if(r.state==='pending')pending.push(r);
   }observeToken();}
   catch{storageError=true;}
   return {pending,corrupt,storageError};
  }
  function snapshot(){const result=scan();result.pending=result.pending.map(r=>({...r,syncStatus:(attempts.get(key(r))||0)>=maxAttempts?'unconfirmed':statuses.get(key(r))||'pending',reason:reasons.get(key(r))||null,canRetryMutation:retries.has(key(r)),canRetrySync:typeof retrySync==='function'}));return clone(result);}
  function clearTimer(){if(timer!==null)unschedule(timer);timer=null;}
  function arm(){clearTimer();if(disposed||!uid||!visible()||busy)return;const list=scan();if(list.storageError)return;const eligible=list.pending.filter(r=>(attempts.get(key(r))||0)<maxAttempts);if(!eligible.length)return;const delay=Math.max(0,Math.min(...eligible.map(r=>(due.get(key(r))||0)-now())));timer=schedule(()=>{timer=null;void poll();},delay);}
  function setAccount(next){epoch++;uid=text(next)?next:null;seenToken=null;busy=false;clearTimer();attempts.clear();due.clear();retries.clear();statuses.clear();reasons.clear();observedTerminals.clear();arm();return snapshot();}
  function begin({route,code,operationId=uuid()}={}){
   if(disposed||!uid)throw Error('auth-required');const r={version:25,authUid:uid,route,operationId,code,state:'pending'};
   if(!valid(r))throw Error('invalid-operation');
   // One unique key per operation, no read/modify/write shared array.
   // A stale replay after settled GC remains pending until rechecked by the server.
   try{const ended=storage.getItem(terminal(r));if(ended!==null){const end=JSON.parse(ended);if(!valid(end)||end.state!=='settled'||end.code!==r.code||end.authUid!==r.authUid||end.route!==r.route||end.operationId!==r.operationId)throw Error('operation-conflict');return clone(end);}const old=storage.getItem(key(r));if(old!==null){const prior=JSON.parse(old);if(!valid(prior)||prior.authUid!==r.authUid||prior.route!==r.route||prior.code!==r.code||prior.operationId!==r.operationId)throw Error('operation-conflict');return clone(prior);}storage.setItem(key(r),JSON.stringify(r));if(storage.getItem(key(r))!==JSON.stringify(r))throw Error('durability-check-failed');}
   catch(e){storageError=true;onChange();throw Error('operation-persistence-failed');}
   onChange();arm();return clone(r);
  }
  async function execute({route,code,send}={}){
   if(typeof send!=='function')throw Error('operation-send-required');
   const record=begin({route,code}),owner=uid,generation=epoch;
   const invoke=()=>{if(disposed||uid!==owner||epoch!==generation)throw Error('stale-session');return send(record.operationId);};
   retries.set(key(record),invoke);
   try{return await invoke();}finally{arm();onChange();}
  }
  async function retryMutation(operationId){const record=scan().pending.find(r=>r.operationId===operationId);if(!record)throw Error('operation-not-pending');const retry=retries.get(key(record));if(!retry)throw Error('original-request-unavailable');try{return await retry();}finally{due.set(key(record),0);attempts.set(key(record),0);arm();onChange();}}
  async function poll(){
   if(disposed||!uid||busy||!visible())return;const list=scan();const record=list.pending.find(r=>(attempts.get(key(r))||0)<maxAttempts&&(due.get(key(r))||0)<=now());if(!record){arm();return;}
   busy=true;const owner=uid,generation=epoch,nonce=uuid(),k=key(record);attempts.set(k,(attempts.get(k)||0)+1);
   const current=()=>!disposed&&uid===owner&&epoch===generation;
   try{
    const request={route:record.route,operationId:record.operationId,nonce,...(record.route==='roster'?{code:record.code}:{})};
    let statusTimer;const result=await Promise.race([Promise.resolve().then(()=>{if(!current())return null;return queryStatus(request);}),new Promise(resolve=>{statusTimer=schedule(()=>resolve(null),timeoutMs);})]).finally(()=>unschedule(statusTimer));
    if(!current())return;
    const bound=result?.schemaVersion===25&&result.scope==='individual-family'&&result.route===record.route&&result.operationId===record.operationId&&result.code===(record.route==='roster'?record.code:null)&&result.nonce===nonce;
    reasons.set(k,bound&&['operation-not-found','needs-repair'].includes(result.reason)?result.reason:null);
    statuses.set(k,bound&&result.status==='pending'&&result.reason!=='needs-repair'?'pending':'unconfirmed');
    if(bound&&result.status==='settled'){
     const latest=JSON.parse(storage.getItem(k)||'null');
     if(!valid(latest)||latest.authUid!==owner||latest.route!==record.route||latest.operationId!==record.operationId||latest.code!==record.code)throw Error('operation-changed');
     if(storage.getItem(terminal(record))===null){
      // Invalidate old summary generation BEFORE making pending disappear.
      onSettling(clone(record));
      if(!current())return;
      storage.setItem(terminal(record),JSON.stringify({...latest,state:'settled'}));observedTerminals.add(terminal(record));collectSettled({...latest,state:'settled'});
     }
    }
   }catch{ if(current())statuses.set(k,'unconfirmed'); /* Unknown never completes an operation. */ }
   finally{if(current()){busy=false;try{if(storage.getItem(k)!==null)due.set(k,now()+Math.min(30000,1000*2**Math.min(attempts.get(k)||1,5)));}catch{storageError=true;}onChange();arm();}}
  }
  async function retryOperationSync(operationId){
   const r=scan().pending.find(x=>x.operationId===operationId);if(!r||typeof retrySync!=='function')throw Error('sync-retry-unavailable');
   const owner=uid,generation=epoch,nonce=uuid();
   const result=await retrySync({route:r.route,operationId:r.operationId,nonce,...(r.route==='roster'?{code:r.code}:{})});
   if(disposed||uid!==owner||epoch!==generation)return;
   const bound=result?.schemaVersion===25&&result.scope==='individual-family'&&result.route===r.route&&result.operationId===r.operationId&&result.code===(r.route==='roster'?r.code:null)&&result.nonce===nonce;
   if(!bound||!['pending','settled'].includes(result.status)){statuses.set(key(r),'unconfirmed');onChange();return;}
   // A retry endpoint response never clears a record directly; reread status.
   attempts.set(key(r),0);due.set(key(r),0);arm();onChange();
  }
  function retryStatus(operationId=null){for(const r of scan().pending.filter(r=>operationId===null||r.operationId===operationId)){attempts.set(key(r),0);due.set(key(r),0);}arm();}
  function storageChanged(event){if(disposed||!uid||!event?.key)return;if(event.key===tokenKey()){try{observeToken();}catch{storageError=true;}onChange();arm();return;}if(!event.key.startsWith(PREFIX+encodeURIComponent(uid)+':'))return;scan();onChange();arm();}
  function visibilityChanged(){clearTimer();if(visible())arm();}
  function dispose(){disposed=true;epoch++;clearTimer();retries.clear();}
  return Object.freeze({setAccount,begin,execute,retryMutation,retryOperationSync,retryStatus,poll,snapshot,storageChanged,visibilityChanged,dispose});
 }
 return {createLedger,PREFIX,TOKEN_PREFIX};
});

},
'./room-contract.cjs':function(module,exports,require){
'use strict';
// Public mirror metadata for display/UI eligibility only, never server authorization.
const own=(x,k)=>!!x&&Object.hasOwn(x,k);
function roomView(code,full,now=Date.now()){
 if(!full||full.code!==code||!Number.isFinite(now))return null;
 const meta=full.parsedData?.meta||{};
 const field=(key)=>own(full,key)?{known:true,value:full[key]}:own(meta,key)?{known:true,value:meta[key]}:{known:false};
 const authority=field('eventAuthority'),quick=field('communityQuickRegistration'),deadline=field('cancellationDeadline');
 let validDeadline=deadline.known&&(deadline.value===null||typeof deadline.value==='number'&&Number.isFinite(deadline.value)&&deadline.value>0||typeof deadline.value==='string'&&Number.isFinite(Date.parse(deadline.value))&&Date.parse(deadline.value)>0);
 const metadataComplete=authority.known&&['official','community','test'].includes(authority.value)&&validDeadline&&(authority.value!=='community'||quick.known&&typeof quick.value==='boolean');
 return {...full,date:full.eventDate??full.date??'',myEventsPublicRead:{code,receivedAt:now,cancellationFieldsComplete:!!metadataComplete,checkInKnown:own(full,'checkInAt')}};
}
function freshCancellationMetadata(info,code,now=Date.now()){
 const m=info?.myEventsPublicRead;return !!(m&&m.code===code&&m.cancellationFieldsComplete&&Number.isFinite(now)&&now>=m.receivedAt&&now-m.receivedAt<=30000);
}
module.exports={roomView,freshCancellationMetadata};

},
'./controller.cjs':function(module,exports,require){
'use strict';
const {createReadEntry}=require('./read-entry.cjs');
const {createLedger}=require('./operation-ledger.js');
const {roomView,freshCancellationMetadata}=require('./room-contract.cjs');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function create({call,summary,changed=()=>{},cooldown,storage,queryStatus,renderCard,ledgerOptions={},now=Date.now}={}){
 let entry=null,key=null,owner=null,generation=0,started=false,ledger=null,untracked=false,trackedResults=new WeakSet(),loading=null,lastReadAt=0,refreshing=false,previousView=null;
 function notify(){const g=generation;queueMicrotask(()=>{if(g===generation)changed();});}
 function fresh(){entry=createReadEntry({call,summary:async code=>roomView(code,await summary(code),now()),cooldown});entry.setAccount(owner);started=false;loading=null;lastReadAt=0;refreshing=false;previousView=null;}
 function invalidate(proven=false,result=null){generation++;if(entry)entry.setAccount(null);const tracked=result&&typeof result==='object'&&trackedResults.has(result);if(tracked)trackedResults.delete(result);if(!proven&&!tracked)untracked=true;fresh();notify();}
 function receipts(){return ledger?ledger.snapshot():{pending:[],corrupt:0,storageError:false};}
 function bind(uid,epoch){const next=JSON.stringify([uid||null,epoch]);if(next===key)return;reset();key=next;owner=uid||null;fresh();if(owner&&storage&&typeof queryStatus==='function'){ledger=createLedger({...ledgerOptions,storage,queryStatus,onSettling:()=>invalidate(true),onChange:notify});ledger.setAccount(owner);}}
 function reset(){generation++;if(entry)entry.setAccount(null);ledger?.dispose();ledger=null;entry=null;owner=null;key=null;started=false;untracked=false;trackedResults=new WeakSet();loading=null;lastReadAt=0;refreshing=false;previousView=null;}
 async function execute(operation){if(!ledger||!owner)throw Error('membership-receipt-unavailable');const mine=ledger,uid=owner,result=await mine.execute(operation);if(mine===ledger&&uid===owner&&result&&typeof result==='object')trackedResults.add(result);return result;}
 async function update(more=false,refresh=false){
  if(!owner||!entry)return;const mine=entry,g=generation;
  const valid=()=>g===generation&&mine===entry;
  if(refresh){previousView=mine.snapshot();refreshing=true;}
  const flight=refresh?mine.refresh():mine.load(more);if(valid())queueMicrotask(()=>{if(valid())changed();});await flight;if(!valid())return;queueMicrotask(()=>{if(valid())changed();});
  for(const room of mine.snapshot().rooms){if(!valid())return;await mine.loadDetails(room.card.code);if(valid())queueMicrotask(()=>{if(valid())changed();});}
  if(valid()){lastReadAt=now();refreshing=false;previousView=null;notify();}
 }
 async function refreshSummary(code){
  if(!entry||!owner)return {applied:false,reason:'no-owner'};
  const mine=entry,g=generation,result=await mine.refreshSummary(code);
  if(mine===entry&&g===generation)notify();return result;
 }
 function startUpdate(more=false,refresh=false){
  if(loading)return loading;
  const promise=update(more,refresh).catch(()=>{refreshing=false;notify();});loading=promise;
  promise.finally(()=>{if(loading===promise)loading=null;});return promise;
 }
 function ensure(){if(started||!owner)return loading||Promise.resolve();started=true;return startUpdate();}
 function action(name,code){if(!entry||!owner)return Promise.resolve();started=true;if(name==='my-events-receipt-recheck'){retryReceipts();return Promise.resolve();}if(name==='my-events-detail-more'){const mine=entry;return mine.loadDetails(code,true).then(()=>{if(mine===entry)notify();});}return startUpdate(name==='my-events-more',name==='my-events-refresh');}
 async function discovery({refreshSummaries=false}={}){
  const mine=entry,g=generation,uid=owner;
  const before=entry?.snapshot(),hasContinuation=!!before?.membership.nextCursor||!!before?.rooms.some(r=>r.nextCursor);
  // Complete a bounded continuation step before restarting a snapshot, so later
  // rooms/family members cannot be permanently starved by the refresh cadence.
  if(started&&owner&&!hasContinuation&&(now()<lastReadAt||now()-lastReadAt>=30000))await startUpdate(false,true);else await ensure();
  const isCurrent=()=>!!uid&&uid===owner&&g===generation&&mine===entry;
  if(!isCurrent())return {status:'unknown',rows:[],summaries:{},complete:false,isCurrent:()=>false};
  if(mine.snapshot().membership.nextCursor)await startUpdate(true,false);
  if(!isCurrent())return {status:'unknown',rows:[],summaries:{},complete:false,isCurrent:()=>false};
  const continuation=mine.snapshot().rooms.find(r=>r.nextCursor);
  if(continuation)await mine.loadDetails(continuation.card.code,true);
  if(!isCurrent())return {status:'unknown',rows:[],summaries:{},complete:false,isCurrent:()=>false};
  if(refreshSummaries){for(const room of mine.snapshot().rooms){if(!isCurrent())break;await refreshSummary(room.card.code);}}
  if(!isCurrent())return {status:'unknown',rows:[],summaries:{},complete:false,isCurrent:()=>false};
  const snapshot=mine.snapshot(),rows=[],summaries={};
  for(const room of snapshot.rooms){if(room.status==='ready'&&room.info){rows.push(...room.rows);summaries[room.card.code]=room.info;}}
  return {status:snapshot.membership.status,rows,summaries,complete:snapshot.membership.complete&&!snapshot.membership.notices.length&&snapshot.rooms.every(r=>r.status==='ready'&&!r.nextCursor&&!r.notices.length),isCurrent};
 }
 function registration(code){const room=entry?.snapshot().rooms.find(r=>r.card.code===code);return room?.status==='ready'?room.rows.find(r=>['confirmed','waitlist'].includes(r.status))||null:null;}
 function cancellationContext(code){
  const receipt=receipts(),s=entry?.snapshot(),room=s?.rooms.find(r=>r.card.code===code);
  if(!owner||!ledger||untracked||refreshing||receipt.pending.length||receipt.corrupt||receipt.storageError||!room||room.status!=='ready'||!room.rows.length||room.nextCursor||room.notices.length||s.membership.notices.length||(room.info?.queueSyncFailed||!freshCancellationMetadata(room.info,code,now())))return null;
  return {info:room.info,owner,key};
 }
 function retryReceipts(){if(!ledger)return;ledger.retryStatus();notify();}
 function render(){
  const receipt=receipts();const pending=refreshing||untracked||receipt.pending.length>0||receipt.corrupt>0||receipt.storageError;const s=refreshing&&previousView?.rooms.length?previousView:entry?.snapshot(),m=s?.membership;
  let body='尚未確認登入與服務狀態。';
  if(owner&&m){
   if(m.status==='idle'||m.status==='loading')body='正在讀取自己的個人／家庭報名……';
   else if(m.confirmedEmpty&&!pending)body=esc(m.emptyText);
   else if(refreshing)body='正在重新確認；暫時保留上次卡片，操作需等待更新完成。';
   else if(untracked)body='此操作缺少可追蹤憑證，無法確認同步結果；重新整理不會被當作已完成。';
   else if(pending)body='操作結果尚未取得已同步憑證，不能判定為沒有報名。';
   else if(m.status==='unknown'||m.status==='synchronizing')body='資料尚未確認／同步完成；不能判定為沒有報名。';
   else body='';
  }
  const rooms=(s?.rooms||[]).map(r=>{
   const complete=r.status==='ready'&&r.info&&r.rows.length&&typeof renderCard==='function';
   const cards=complete?r.rows.map(row=>renderCard(row,r.info,{allowCancel:!!cancellationContext(r.card.code)})).join(''):`<p>賽事 ${esc(r.card.code)} 的報名明細尚未確認。</p>`;
   return cards+(r.nextCursor?`<p>家庭報名明細尚未完整。</p><button class="btn" data-action="my-events-detail-more" data-code="${esc(r.card.code)}">讀取更多家庭報名</button>`:'')+(r.notices?.length?'<p>此場資料仍有同步提醒，不能推定完整。</p>':'');
  }).join('');
  return `<section data-my-events-read-slice="true"><h3>目前個人／家庭報名</h3><p role="status">歷史、團體與抽籤不在此清單範圍。候選尚未通過正式瀏覽器驗收；叫號為已讀取的快照。</p><p>${body}</p>${m?.notices?.length?'<p>仍有同步提醒，清單不可視為完整。</p>':''}${rooms}${receipt.pending.length?'<button class="btn" data-action="my-events-receipt-recheck">重新查詢操作同步狀態</button>':''}<button class="btn" data-action="my-events-refresh">重新確認</button>${m?.nextCursor?'<button class="btn" data-action="my-events-more">讀取下一頁報名</button>':''}${m&&!m.complete?'<p>清單尚未完整，未出現不代表未報名。</p>':''}</section>`;
 }
 return Object.freeze({bind,reset,ensure,action,render,execute,refreshSummary,invalidate:result=>invalidate(false,result),storageChanged:event=>ledger?.storageChanged(event),visibilityChanged:()=>ledger?.visibilityChanged(),discovery,registration,cancellationContext,receiptSnapshot:receipts,pollReceipts:()=>ledger?.poll(),snapshot:()=>entry?.snapshot()||null});
}
module.exports={create};

}
};const cache={};function require(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;modules[name](module,module.exports,require);return module.exports;}root.BXHMyEventsPlayerSlice=require('./controller.cjs');
})(globalThis);
