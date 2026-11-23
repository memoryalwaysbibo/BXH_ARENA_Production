// Local ARENA fixture build only. No production Firebase or URL-based opt-in.
(function(root){
"use strict";
const valid=v=>Number.isSafeInteger(v)&&v>=0;
const codePattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function create({transport,notify=()=>{}}){
  let state=null,fresh=false,error=false,stop=null,epoch=0,observedFloor=-1,queue=Promise.resolve();
  let catalogVersion=null,catalogToken=0,catalogWatchEpoch=0,catalogStop=null,catalogPending=null;
  const catalogSupported=typeof transport.readCatalog==="function"&&typeof transport.watchCatalogVersion==="function";
  const emptyCatalog=()=>({mode:null,filters:null,cards:[],next:null,loading:false,stale:false,error:false,loaded:false});
  let catalog=emptyCatalog();
  const active=c=>!!stop&&c===epoch;
  function staleCatalog({discard=false}={}){
    catalogToken++;
    catalog=discard?emptyCatalog():{...catalog,cards:[],next:null,loading:false,stale:!!catalog.mode,error:false,loaded:false};
  }
  function stopCatalog(){
    catalogWatchEpoch++;catalogVersion=null;catalogPending=null;
    const unsub=catalogStop;catalogStop=null;unsub?.();
  }
  function openCatalog(mode,filters={}){
    if(!catalogSupported||!stop||!fresh||!state)return false;
    if(catalogVersion!==null)return runCatalog(mode,filters,false);
    catalogToken++;
    catalog={...emptyCatalog(),mode,filters,loading:true};
    catalogPending={mode,filters};notify();
    if(catalogStop)return true;
    const watchEpoch=++catalogWatchEpoch;
    const usable=()=>!!stop&&watchEpoch===catalogWatchEpoch;
    catalogStop=()=>{};
    const onError=()=>{
      if(!usable())return;
      stopCatalog();staleCatalog();catalog={...catalog,stale:false,error:true};notify();
    };
    try{
      const end=transport.watchCatalogVersion(signal=>{
        if(!usable())return;
        const server=signal?.fromCache===false&&signal?.hasPendingWrites===false&&valid(signal.version);
        if(!server){
          if(catalogVersion!==null){catalogVersion=null;staleCatalog();notify();}
          return;
        }
        if(catalogVersion!==null&&signal.version<=catalogVersion)return;
        const pending=catalogPending;
        const wasConfirmed=catalogVersion!==null;
        catalogVersion=signal.version;
        if(pending){catalogPending=null;void runCatalog(pending.mode,pending.filters,false);}
        else if(wasConfirmed){staleCatalog();notify();}
      },onError);
      if(usable()&&typeof end==="function")catalogStop=end;else if(typeof end==="function")end();
    }catch{onError();}
    return true;
  }
  async function runCatalog(mode,filters={},append=false){
    if(!catalogSupported||!stop||!fresh||catalogVersion===null||!state)return false;
    if(append&&(catalog.loading||!catalog.next))return false;
    const version=catalogVersion,c=epoch,token=++catalogToken;
    const live=()=>active(c)&&token===catalogToken&&version===catalogVersion&&fresh;
    const before=append?catalog.cards:[];
    let cursor=append?catalog.next:null;
    catalog={...emptyCatalog(),mode,filters,cards:before,loading:true};
    notify();
    try{
      let body=await transport.readCatalog({version,filters,cursor});
      if(!live())return false;
      if(body?.kind==="restart"){staleCatalog();notify();return false;}
      if(body?.kind!=="page"||body.version!==version||!checkedCards(body.cards))throw Error("catalog-page");
      const baseIds=new Set(state.cards.map(card=>card.id));
      if(!append&&mode==="browse"&&body.next&&body.cards.every(card=>baseIds.has(card.id))){
        body=await transport.readCatalog({version,filters,cursor:body.next});
        if(!live())return false;
        if(body?.kind==="restart"){staleCatalog();notify();return false;}
        if(body?.kind!=="page"||body.version!==version||!checkedCards(body.cards))throw Error("catalog-next");
      }
      const distinct=new Map([...before,...body.cards].map(card=>[card.id,card]));
      catalog={...catalog,cards:[...distinct.values()],next:body.next??null,loading:false,loaded:true};
      notify();return true;
    }catch{
      if(live()){catalog={...catalog,next:cursor,loading:false,error:true,loaded:append};notify();}
      return false;
    }
  }
  function mark(next,c){if(active(c)&&fresh!==next){fresh=next;notify();}}
  function fail(c){if(active(c)){const changed=fresh||!error;fresh=false;error=true;if(changed)notify();}}
  function accept(next,c){
    if(!active(c))return;
    const changed=state?.version!==next.version||!fresh||error;
    state=next;fresh=true;error=false;if(changed)notify();
  }
  function checkedCards(cards){
    return Array.isArray(cards)&&cards.length<=20&&cards.every(card=>typeof card?.id==="string"&&codePattern.test(card.id)&&typeof card.title==="string")&&new Set(cards.map(card=>card.id)).size===cards.length;
  }
  function onSignal(signal,c){
    if(!active(c))return;
    const confirmed=signal?.fromCache===false&&signal?.hasPendingWrites===false&&valid(signal.version);
    if(confirmed&&signal.version>observedFloor){
      observedFloor=signal.version;
      if(signal.previous===null&&state&&signal.version>state.version){
        state=null;fresh=false;error=false;queue=Promise.resolve();
        if(catalog.mode){stopCatalog();staleCatalog();}
        notify({reason:"confirmed-reset"});
      }
    }
    queue=queue.then(async()=>{
      if(!active(c))return;
      if(!signal||signal.fromCache!==false||signal.hasPendingWrites!==false){if(fresh&&catalog.mode){stopCatalog();staleCatalog();}mark(false,c);return;}
      if(!valid(signal.version))throw Error("summary-version");
      if(signal.version<observedFloor||state?.version>signal.version)return;
      if(state?.version===signal.version){accept(state,c);return;}
      if(state&&state.version===signal.previous){
        const delta=await transport.readDelta(state.version,signal.version);
        if(!active(c)||signal.version<observedFloor)return;
        if(delta?.to===signal.version&&delta?.from===state.version&&Array.isArray(delta.remove)&&checkedCards(delta.upsert)&&Array.isArray(delta.order)){
          const cards=new Map(state.cards.map(card=>[card.id,card]));
          for(const id of delta.remove)cards.delete(id);
          for(const card of delta.upsert)cards.set(card.id,card);
          const ordered=delta.order.map(id=>cards.get(id));
          if(ordered.length===cards.size&&checkedCards(ordered)){accept({version:signal.version,cards:ordered},c);return;}
        }
      }
      const page=await transport.readFirst(signal.version);
      if(!active(c))return;
      if(!valid(page?.version)||page.version<signal.version||!checkedCards(page.cards))throw Error("summary-page");
      if(page.version<observedFloor)return;
      accept({version:page.version,cards:page.cards},c);
    }).catch(()=>fail(c));
  }
  return {
    start(){
      if(stop)return;
      const c=++epoch;queue=Promise.resolve();stop=()=>{};
      try{const unsubscribe=transport.watch(s=>onSignal(s,c),()=>{if(active(c)){stopCatalog();staleCatalog();queue=queue.then(()=>fail(c));}});stop=typeof unsubscribe==="function"?unsubscribe:()=>{};}
      catch{fail(c);}
    },
    stop({discard=false}={}){
      const end=stop;stop=null;epoch++;fresh=false;stopCatalog();
      if(discard||catalog.mode)staleCatalog({discard});
      if(discard){state=null;error=false;observedFloor=-1;}
      if(end)end();
    },
    search(filters){return openCatalog("search",filters);},
    more(){return catalog.next?runCatalog(catalog.mode,catalog.filters,true):openCatalog("browse");},
    retryCatalog(){return catalog.mode?openCatalog(catalog.mode,catalog.filters):false;},
    clearCatalog(){stopCatalog();staleCatalog({discard:true});notify();},
    snapshot(){
      const displayCards=catalog.mode==="search"?catalog.cards:state?.cards&&[...new Map([...state.cards,...catalog.cards].map(card=>[card.id,card])).values()];
      return {catalogSupported,catalog,displayCards,cards:state?.cards||null,version:state?.version??null,freshness:fresh?"server":"unknown",error};},
    settled(){return queue;}
  };
}
function getLocalTransport(){
  if(!["localhost","127.0.0.1","[::1]"].includes(root.location?.hostname))return null;
  const t=root.BXH_ARENA_HOME_LAB_TRANSPORT;
  return t?.synthetic===true&&["watch","readFirst","readDelta"].every(m=>typeof t[m]==="function")?t:null;
}
function toLobbyItem(card){
  const shifted=typeof card.eventAt==="number"?new Date(card.eventAt+8*3600000):null;
  const period=shifted&&Number.isFinite(shifted.getTime())?shifted.toISOString().slice(0,16).split("T"):["",""];
  const phase=card.eventPhase||"waiting";
  const authority=card.authority==="partner"?"ticket":(["official","ticket","community"].includes(card.authority)?card.authority:"official");
  return {
    homeSummaryFixture:true,code:card.id,name:card.title,eventDate:card.eventDate??period[0],startAt:card.startAt??period[1],visibility:"public",
    publishedAt:card.publishedAt===undefined?1:card.publishedAt,eventAuthority:authority,tournamentPhase:phase,
    eventCancelled:phase==="cancelled"||card.registrationStatus==="cancelled",
    hostName:card.hostName,location:card.location,formatType:card.formatType,battleMode:card.battleMode,
    teamSize:card.teamSize,roomAccessMode:card.roomAccessMode,
    ladderMode:card.ranked?"ranked":"general",registrationStatus:card.registrationStatus,
    registrationEnabled:typeof card.registrationEnabled==="boolean"?card.registrationEnabled:card.registrationStatus!=="draft",
    registrationOpenAt:card.openAt,registrationCloseAt:card.closeAt,cancellationDeadline:card.cancellationDeadline,
    capacity:card.capacity,confirmedCount:card.confirmedCount,waitlistCount:card.waitlistCount,waitlistCapacity:card.waitlistCapacity,
    waitlistEnabled:typeof card.waitlistEnabled==="boolean"?card.waitlistEnabled:Number.isFinite(card.waitlistCapacity)&&card.waitlistCapacity>0,
    communityQuickRegistration:card.communityQuickRegistration===true,communityParticipantCount:card.communityParticipantCount,
    registrationSelection:card.registrationSelection,fee:card.fee,checkInAt:card.checkInAt,
    registeredCount:card.registeredCount,targetGroup:card.targetGroup,systemClosure:card.systemClosed===true?{}:null
  };
}
root.BXHArenaHomeSummaryLab={create,getLocalTransport,toLobbyItem};
})(typeof window==="undefined"?globalThis:window);
