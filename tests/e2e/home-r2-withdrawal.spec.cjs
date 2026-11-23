'use strict';
const { test, expect } = require('@playwright/test');
// Frozen #845 lab controller Git blob; only loaded inside synthetic test pages.
const controller = "// Local ARENA fixture build only. No production Firebase or URL-based opt-in.\n(function(root){\n\"use strict\";\nconst valid=v=>Number.isSafeInteger(v)&&v>=0;\nconst codePattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;\nfunction create({transport,notify=()=>{}}){\n  let state=null,fresh=false,error=false,stop=null,epoch=0,observedFloor=-1,queue=Promise.resolve();\n  let catalogVersion=null,catalogToken=0,catalogWatchEpoch=0,catalogStop=null,catalogPending=null;\n  const catalogSupported=typeof transport.readCatalog===\"function\"&&typeof transport.watchCatalogVersion===\"function\";\n  const emptyCatalog=()=>({mode:null,filters:null,cards:[],next:null,loading:false,stale:false,error:false,loaded:false});\n  let catalog=emptyCatalog();\n  const active=c=>!!stop&&c===epoch;\n  function staleCatalog({discard=false}={}){\n    catalogToken++;\n    catalog=discard?emptyCatalog():{...catalog,cards:[],next:null,loading:false,stale:!!catalog.mode,error:false,loaded:false};\n  }\n  function stopCatalog(){\n    catalogWatchEpoch++;catalogVersion=null;catalogPending=null;\n    const unsub=catalogStop;catalogStop=null;unsub?.();\n  }\n  function openCatalog(mode,filters={}){\n    if(!catalogSupported||!stop||!fresh||!state)return false;\n    if(catalogVersion!==null)return runCatalog(mode,filters,false);\n    catalogToken++;\n    catalog={...emptyCatalog(),mode,filters,loading:true};\n    catalogPending={mode,filters};notify();\n    if(catalogStop)return true;\n    const watchEpoch=++catalogWatchEpoch;\n    const usable=()=>!!stop&&watchEpoch===catalogWatchEpoch;\n    catalogStop=()=>{};\n    const onError=()=>{\n      if(!usable())return;\n      stopCatalog();staleCatalog();catalog={...catalog,stale:false,error:true};notify();\n    };\n    try{\n      const end=transport.watchCatalogVersion(signal=>{\n        if(!usable())return;\n        const server=signal?.fromCache===false&&signal?.hasPendingWrites===false&&valid(signal.version);\n        if(!server){\n          if(catalogVersion!==null){catalogVersion=null;staleCatalog();notify();}\n          return;\n        }\n        if(catalogVersion!==null&&signal.version<=catalogVersion)return;\n        const pending=catalogPending;\n        const wasConfirmed=catalogVersion!==null;\n        catalogVersion=signal.version;\n        if(pending){catalogPending=null;void runCatalog(pending.mode,pending.filters,false);}\n        else if(wasConfirmed){staleCatalog();notify();}\n      },onError);\n      if(usable()&&typeof end===\"function\")catalogStop=end;else if(typeof end===\"function\")end();\n    }catch{onError();}\n    return true;\n  }\n  async function runCatalog(mode,filters={},append=false){\n    if(!catalogSupported||!stop||!fresh||catalogVersion===null||!state)return false;\n    if(append&&(catalog.loading||!catalog.next))return false;\n    const version=catalogVersion,c=epoch,token=++catalogToken;\n    const live=()=>active(c)&&token===catalogToken&&version===catalogVersion&&fresh;\n    const before=append?catalog.cards:[];\n    let cursor=append?catalog.next:null;\n    catalog={...emptyCatalog(),mode,filters,cards:before,loading:true};\n    notify();\n    try{\n      let body=await transport.readCatalog({version,filters,cursor});\n      if(!live())return false;\n      if(body?.kind===\"restart\"){staleCatalog();notify();return false;}\n      if(body?.kind!==\"page\"||body.version!==version||!checkedCards(body.cards))throw Error(\"catalog-page\");\n      const baseIds=new Set(state.cards.map(card=>card.id));\n      if(!append&&mode===\"browse\"&&body.next&&body.cards.every(card=>baseIds.has(card.id))){\n        body=await transport.readCatalog({version,filters,cursor:body.next});\n        if(!live())return false;\n        if(body?.kind===\"restart\"){staleCatalog();notify();return false;}\n        if(body?.kind!==\"page\"||body.version!==version||!checkedCards(body.cards))throw Error(\"catalog-next\");\n      }\n      const distinct=new Map([...before,...body.cards].map(card=>[card.id,card]));\n      catalog={...catalog,cards:[...distinct.values()],next:body.next??null,loading:false,loaded:true};\n      notify();return true;\n    }catch{\n      if(live()){catalog={...catalog,next:cursor,loading:false,error:true,loaded:append};notify();}\n      return false;\n    }\n  }\n  function mark(next,c){if(active(c)&&fresh!==next){fresh=next;notify();}}\n  function fail(c){if(active(c)){const changed=fresh||!error;fresh=false;error=true;if(changed)notify();}}\n  function accept(next,c){\n    if(!active(c))return;\n    const changed=state?.version!==next.version||!fresh||error;\n    state=next;fresh=true;error=false;if(changed)notify();\n  }\n  function checkedCards(cards){\n    return Array.isArray(cards)&&cards.length<=20&&cards.every(card=>typeof card?.id===\"string\"&&codePattern.test(card.id)&&typeof card.title===\"string\")&&new Set(cards.map(card=>card.id)).size===cards.length;\n  }\n  function onSignal(signal,c){\n    if(!active(c))return;\n    const confirmed=signal?.fromCache===false&&signal?.hasPendingWrites===false&&valid(signal.version);\n    if(confirmed&&signal.version>observedFloor){\n      observedFloor=signal.version;\n      if(signal.previous===null&&state&&signal.version>state.version){\n        state=null;fresh=false;error=false;queue=Promise.resolve();\n        if(catalog.mode){stopCatalog();staleCatalog();}\n        notify();\n      }\n    }\n    queue=queue.then(async()=>{\n      if(!active(c))return;\n      if(!signal||signal.fromCache!==false||signal.hasPendingWrites!==false){if(fresh&&catalog.mode){stopCatalog();staleCatalog();}mark(false,c);return;}\n      if(!valid(signal.version))throw Error(\"summary-version\");\n      if(signal.version<observedFloor||state?.version>signal.version)return;\n      if(state?.version===signal.version){accept(state,c);return;}\n      if(state&&state.version===signal.previous){\n        const delta=await transport.readDelta(state.version,signal.version);\n        if(!active(c)||signal.version<observedFloor)return;\n        if(delta?.to===signal.version&&delta?.from===state.version&&Array.isArray(delta.remove)&&checkedCards(delta.upsert)&&Array.isArray(delta.order)){\n          const cards=new Map(state.cards.map(card=>[card.id,card]));\n          for(const id of delta.remove)cards.delete(id);\n          for(const card of delta.upsert)cards.set(card.id,card);\n          const ordered=delta.order.map(id=>cards.get(id));\n          if(ordered.length===cards.size&&checkedCards(ordered)){accept({version:signal.version,cards:ordered},c);return;}\n        }\n      }\n      const page=await transport.readFirst(signal.version);\n      if(!active(c))return;\n      if(!valid(page?.version)||page.version<signal.version||!checkedCards(page.cards))throw Error(\"summary-page\");\n      if(page.version<observedFloor)return;\n      accept({version:page.version,cards:page.cards},c);\n    }).catch(()=>fail(c));\n  }\n  return {\n    start(){\n      if(stop)return;\n      const c=++epoch;queue=Promise.resolve();stop=()=>{};\n      try{const unsubscribe=transport.watch(s=>onSignal(s,c),()=>{if(active(c)){stopCatalog();staleCatalog();queue=queue.then(()=>fail(c));}});stop=typeof unsubscribe===\"function\"?unsubscribe:()=>{};}\n      catch{fail(c);}\n    },\n    stop({discard=false}={}){\n      const end=stop;stop=null;epoch++;fresh=false;stopCatalog();\n      if(discard||catalog.mode)staleCatalog({discard});\n      if(discard){state=null;error=false;observedFloor=-1;}\n      if(end)end();\n    },\n    search(filters){return openCatalog(\"search\",filters);},\n    more(){return catalog.next?runCatalog(catalog.mode,catalog.filters,true):openCatalog(\"browse\");},\n    retryCatalog(){return catalog.mode?openCatalog(catalog.mode,catalog.filters):false;},\n    clearCatalog(){stopCatalog();staleCatalog({discard:true});notify();},\n    snapshot(){\n      const displayCards=catalog.mode===\"search\"?catalog.cards:state?.cards&&[...new Map([...state.cards,...catalog.cards].map(card=>[card.id,card])).values()];\n      return {catalogSupported,catalog,displayCards,cards:state?.cards||null,version:state?.version??null,freshness:fresh?\"server\":\"unknown\",error};},\n    settled(){return queue;}\n  };\n}\nfunction getLocalTransport(){\n  if(![\"localhost\",\"127.0.0.1\",\"[::1]\"].includes(root.location?.hostname))return null;\n  const t=root.BXH_ARENA_HOME_LAB_TRANSPORT;\n  return t?.synthetic===true&&[\"watch\",\"readFirst\",\"readDelta\"].every(m=>typeof t[m]===\"function\")?t:null;\n}\nfunction toLobbyItem(card){\n  const shifted=typeof card.eventAt===\"number\"?new Date(card.eventAt+8*3600000):null;\n  const period=shifted&&Number.isFinite(shifted.getTime())?shifted.toISOString().slice(0,16).split(\"T\"):[\"\",\"\"];\n  const phase=card.eventPhase||\"waiting\";\n  const authority=card.authority===\"partner\"?\"ticket\":([\"official\",\"ticket\",\"community\"].includes(card.authority)?card.authority:\"official\");\n  return {\n    homeSummaryFixture:true,code:card.id,name:card.title,eventDate:card.eventDate??period[0],startAt:card.startAt??period[1],visibility:\"public\",\n    publishedAt:card.publishedAt===undefined?1:card.publishedAt,eventAuthority:authority,tournamentPhase:phase,\n    eventCancelled:phase===\"cancelled\"||card.registrationStatus===\"cancelled\",\n    hostName:card.hostName,location:card.location,formatType:card.formatType,battleMode:card.battleMode,\n    teamSize:card.teamSize,roomAccessMode:card.roomAccessMode,\n    ladderMode:card.ranked?\"ranked\":\"general\",registrationStatus:card.registrationStatus,\n    registrationEnabled:typeof card.registrationEnabled===\"boolean\"?card.registrationEnabled:card.registrationStatus!==\"draft\",\n    registrationOpenAt:card.openAt,registrationCloseAt:card.closeAt,cancellationDeadline:card.cancellationDeadline,\n    capacity:card.capacity,confirmedCount:card.confirmedCount,waitlistCount:card.waitlistCount,waitlistCapacity:card.waitlistCapacity,\n    waitlistEnabled:typeof card.waitlistEnabled===\"boolean\"?card.waitlistEnabled:Number.isFinite(card.waitlistCapacity)&&card.waitlistCapacity>0,\n    communityQuickRegistration:card.communityQuickRegistration===true,communityParticipantCount:card.communityParticipantCount,\n    registrationSelection:card.registrationSelection,fee:card.fee,checkInAt:card.checkInAt,\n    registeredCount:card.registeredCount,targetGroup:card.targetGroup,systemClosure:card.systemClosed===true?{}:null\n  };\n}\nroot.BXHArenaHomeSummaryLab={create,getLocalTransport,toLobbyItem};\n})(typeof window===\"undefined\"?globalThis:window);\n";

test.use({ serviceWorkers: 'block' });

async function openFixture(page) {
  await page.route('**/*', r => r.abort());
  await page.setContent('<!doctype html><meta charset="utf-8"><ul id="cards"></ul>');
  await page.addScriptTag({ content: controller });
  await page.evaluate(() => {
    const publicRoom = { id: 'DEMO-KEEP', title: 'Unchanged room' };
    const privateRoom = { id: 'DEMO-WITHDRAW', title: 'Withdrawn room' };
    const list = document.getElementById('cards');
    let signal, releaseFirst, releaseDelta, old, readingFirst = false, readingDelta = false;
    const app = window.BXHArenaHomeSummaryLab.create({
      transport: {
        watch(callback) { signal = callback; return () => { signal = undefined; }; },
        readFirst(version) {
          if (version === 1) return Promise.resolve({ version: 1, cards: [privateRoom, publicRoom] });
          readingFirst = true;
          return new Promise(resolve => { releaseFirst = () => resolve({ version: 3, cards: [publicRoom] }); });
        },
        readDelta() {
          readingDelta = true;
          return new Promise(resolve => {
            releaseDelta = () => resolve({ from: 1, to: 2, remove: [], upsert: [privateRoom], order: [privateRoom.id, publicRoom.id] });
          });
        },
      },
      // Isolated DOM renderer intentionally clears on reset before fetching
      // the new first page. This is not the production homepage renderer.
      notify() {
        const snapshot = app.snapshot();
        if (!snapshot.cards) { list.replaceChildren(); return; }
        if (snapshot.freshness !== 'server') return;
        list.replaceChildren(...snapshot.cards.map(card => {
          const li = document.createElement('li');
          li.id = card.id; li.textContent = card.title; return li;
        }));
      },
    });
    app.start();
    const send = (version, previous) => signal({ version, previous, fromCache: false, hasPendingWrites: false });
    window.r2 = {
      initial() { send(1, null); return app.settled(); },
      pendDelta() { send(2, 1); old = app.settled(); },
      reset() { send(3, null); },
      cacheSignal() { signal({ fromCache: true, hasPendingWrites: false }); return app.settled(); },
      firstPending: () => readingFirst,
      deltaPending: () => readingDelta,
      releaseFirst() { releaseFirst(); return app.settled(); },
      releaseDelta() { releaseDelta(); return old; },
    };
  });
  await page.evaluate(() => window.r2.initial());
  await expect(page.locator('#DEMO-WITHDRAW')).toBeVisible();
  await expect(page.locator('#DEMO-KEEP')).toBeVisible();
}

test('Home R2 teardown fixture clears old DOM before new first page and rejects a late delta', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.r2.pendDelta());
  await expect.poll(() => page.evaluate(() => window.r2.deltaPending())).toBe(true);
  await page.evaluate(() => window.r2.reset());
  await expect.poll(() => page.evaluate(() => window.r2.firstPending())).toBe(true);
  await expect(page.locator('#DEMO-WITHDRAW')).toHaveCount(0);
  await page.evaluate(() => window.r2.releaseDelta());
  await expect(page.locator('#DEMO-WITHDRAW')).toHaveCount(0);
  await page.evaluate(() => window.r2.releaseFirst());
  await expect(page.locator('#DEMO-KEEP')).toBeVisible();
  await expect(page.locator('#DEMO-WITHDRAW')).toHaveCount(0);
});

test('Home R2 reconnect fixture drops withdrawn card on the first confirmed signal', async ({ page, context }) => {
  await openFixture(page);
  await context.setOffline(true);
  await page.evaluate(() => window.r2.cacheSignal());
  await context.setOffline(false);
  await page.evaluate(() => window.r2.reset());
  await expect.poll(() => page.evaluate(() => window.r2.firstPending())).toBe(true);
  await expect(page.locator('#DEMO-WITHDRAW')).toHaveCount(0);
  await page.evaluate(() => window.r2.releaseFirst());
  await expect(page.locator('#DEMO-KEEP')).toBeVisible();
  await expect(page.locator('#DEMO-WITHDRAW')).toHaveCount(0);
});
