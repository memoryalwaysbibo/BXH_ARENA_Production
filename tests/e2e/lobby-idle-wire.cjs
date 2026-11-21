'use strict';

const DATABASE = 'projects/demo-bxh-arena-e2e/databases/(default)';
const LISTEN = '/google.firestore.v1.Firestore/Listen/channel';
const PATHS = new Set(['/google.firestore.v1.Firestore/RunQuery',
  '/google.firestore.v1.Firestore/RunQuery/channel', '/v1/' + DATABASE + '/documents:runQuery']);
const SIZE_FIELDS = ['requestBodySize', 'requestHeadersSize', 'responseBodySize', 'responseHeadersSize'];

function listenEvents(url, method, body) {
  if (url.searchParams.get('database') !== DATABASE) throw Error('listen-unexpected-database');
  // Pinned SDK uses POST WebChannel form keys for outbound commands; parse the
  // query string as well for a potential supported fast-handshake GET.
  const params = new URLSearchParams(url.search);
  if (body) {
    if (method !== 'POST') throw Error('listen-unexpected-body');
    for(const [key,value] of new URLSearchParams(body)) params.append(key,value);
  }
  const entries = [...params].filter(([key]) => /^req\d+_/.test(key));
  const count = params.get('count');
  if ((body && count===null) || (count!==null && (!/^\d+$/.test(count) || Number(count)!==entries.length)) ||
      entries.some(([k])=>!/^req\d+___data__$/.test(k)) || new Set(entries.map(([k])=>k)).size!==entries.length) throw Error('listen-unrecognized-form');
  return entries.map(([,value]) => {
    const data = JSON.parse(value);
    if(data?.database!==DATABASE) throw Error('listen-unexpected-command-database');
    if (Object.hasOwn(data,'addTarget')===Object.hasOwn(data,'removeTarget')) throw Error('listen-unrecognized-command');
    if (Object.hasOwn(data,'removeTarget')) {
      if (!Number.isSafeInteger(data.removeTarget) || data.removeTarget<=0) throw Error('listen-invalid-remove');
      return {type:'remove',id:data.removeTarget};
    }
    const {targetId:id,query,documents}=data.addTarget || {};
    if (!Number.isSafeInteger(id) || id<=0 || (!query?.structuredQuery && !Array.isArray(documents?.documents))) throw Error('listen-invalid-add');
    const q=query?.structuredQuery, f=q?.where?.fieldFilter;
    const homepage=Boolean(query?.parent===DATABASE+'/documents' && q?.from?.length===1 &&
      q.from[0].collectionId==='publicTournaments' && !q.from[0].allDescendants &&
      f?.field?.fieldPath==='visibility' && f?.op==='EQUAL' && f?.value?.stringValue==='public' && !q.limit && !q.startAt && !q.endAt);
    return {type:'add',id,homepage};
  });
}

function inspectRequest(r) {
  const url = new URL(r.url());
  if (url.origin !== 'http://127.0.0.1:8080') return null;
  if (PATHS.has(url.pathname)) return {kind:'runQuery',events:[]};
  if (url.pathname !== LISTEN) return null;
  try {
    return {kind:'listen',events:listenEvents(url,r.method(),r.postDataBuffer()?.toString('utf8'))};
  } catch {
    return {kind:'listen',events:[],protocolUnknown:true};
  }
}

function sumCompletedHttp(rows) {
  return Object.fromEntries(SIZE_FIELDS.map(key=>[key,rows.reduce((out,row)=>out+row.sizes[key],0)]));
}

function summarize(rows, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start) throw Error('invalid-measurement-window');
  const live = new Map();
  let warmUnknown=false, unknownRemoval=0, homepageAdds=0, homepageRemoves=0;
  const before=rows.filter(r=>r.start<start);
  // Event timing is Node's monotonic request-event time, independent from
  // fixture/app clocks. Commands sent at start exactly belong to idle.
  const inside=rows.filter(r=>r.start>=start && r.start<end);
  const within = r=>r.start>=start && r.start<end && r.end>=r.start && r.end<=end;
  function apply(row, active) {
    if(row.protocolUnknown&&!active) warmUnknown=true;
    for(const event of row.events) {
      if(event.type==='add') {
        live.set(event.id,{homepage:event.homepage,row});
        if(active&&event.homepage) homepageAdds++;
      } else {
        if(active&&!live.has(event.id)) unknownRemoval++;
        if(active&&live.get(event.id)?.homepage===true) homepageRemoves++;
        live.delete(event.id);
      }
    }
  }
  for(const r of before) apply(r,false);
  const warm=[...live.values()].filter(x=>x.homepage);
  const warmIds=warm.length;
  const warmConfirmed=warmIds>0 && warm.every(({row:r})=>r.end<start && r.status>=200 && r.status<300);
  for(const r of inside) apply(r,true);

  const malformedIdle=inside.filter(r=>r.protocolUnknown).length;
  const uncompletedCommands=inside.filter(r=>r.events.length>0 && !(within(r)&&r.status>=200&&r.status<300)).length;
  const commandMeasurable=warmConfirmed && warmIds>=1 && !warmUnknown && !unknownRemoval && !malformedIdle && !uncompletedCommands;
  const overlap=rows.filter(r=>r.start<end && (r.end===undefined||r.end>start));
  const completed=inside.filter(r=>within(r)&&r.status>=200&&r.status<300);
  const boundary=overlap.filter(r=>r.start<start||r.end===undefined||r.end>end).length;
  const missingStatus=inside.filter(r=>within(r) && !Number.isInteger(r.status)).length;
  const failedInside=inside.filter(r=>within(r) && Number.isInteger(r.status) && !(r.status>=200&&r.status<300)).length;
  const sized=completed.filter(r=>SIZE_FIELDS.every(key=>Number.isSafeInteger(r.sizes?.[key])&&r.sizes[key]>=0));
  const missingSizes=completed.length-sized.length;
  const httpFullyMeasured=warmConfirmed && warmIds>=1 && !boundary && !failedInside && !missingStatus && !missingSizes;

  return {
    listenTargets:{status:commandMeasurable?'measured':'unmeasurable',
      homepageAdds:commandMeasurable?homepageAdds:null,homepageRemoves:commandMeasurable?homepageRemoves:null,
      warmHomepageTargetCount:warmIds,warmConfirmed,warmUnknown,unknownRemoval,malformedIdle,uncompletedCommands},
    http:{status:httpFullyMeasured?'complete-window':'completed-subset-only',
      totalWindowHttpBytes:httpFullyMeasured?Object.values(sumCompletedHttp(sized)).reduce((a,b)=>a+b,0):null,
      completed:{listen:sumCompletedHttp(sized.filter(r=>r.kind==='listen')),runQuery:sumCompletedHttp(sized.filter(r=>r.kind==='runQuery'))},
      whollyContainedCompletedWithSizes:sized.length,boundaryOrOpen:boundary,failedInside,missingStatus,missingSizes,
      runQueryRequestsStarted:inside.filter(r=>r.kind==='runQuery').length},
  };
}

function attachWireObserver(context, clock) {
  const rows=[], requests=new WeakMap();
  context.on('request', req=>{
    const details=inspectRequest(req);
    if(!details)return;
    const row={start:clock(),...details};
    rows.push(row);
    requests.set(req,row);
  });
  context.on('response', response=>{
    const row=requests.get(response.request());
    if(row)row.status=response.status();
  });
  context.on('requestfinished', req=>{
    const row=requests.get(req);
    if(!row)return;
    row.end=clock(); // Capture before sizes()/response() awaits.
    row.sizeTask=(async()=>{
      if(row.status===undefined) row.status=(await req.response())?.status();
      row.sizes=await req.sizes();
    })().catch(()=>{row.sizes=null;});
  });
  context.on('requestfailed',req=>{
    const row=requests.get(req);
    if(row){row.end=clock();row.status=-1;}
  });
  return {
    async report(start,end,sleep){
      const awaitable=rows.filter(r=>r.end<=end&&r.start<end&&r.sizeTask).map(r=>r.sizeTask);
      // Do not let open streams or delayed size instrumentation extend the
      // measurement. A bounded settle can enrich only already-finished events.
      await Promise.race([Promise.allSettled(awaitable),sleep(2000)]);
      return summarize(rows,start,end);
    },
  };
}

module.exports={listenEvents,inspectRequest,summarize,attachWireObserver};
