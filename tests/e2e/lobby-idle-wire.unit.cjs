'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachWireObserver, inspectRequest, summarize } = require('./lobby-idle-wire.cjs');

const db='projects/demo-bxh-arena-e2e/databases/(default)';
const listen='http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel?database='+encodeURIComponent(db);
// HTTP form shape captured from actual 10.13.0 CI trace (irrelevant auth
// headers intentionally omitted). Only synthetic collection/query data below.
const target={targetId:8,query:{parent:db+'/documents',structuredQuery:{from:[{collectionId:'publicTournaments'}],
  where:{fieldFilter:{field:{fieldPath:'visibility'},op:'EQUAL',value:{stringValue:'public'}}},
  orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]}}};
const frm=(...events)=>new URLSearchParams([['count',String(events.length)],['ofs','4'],...events.map((e,i)=>['req'+i+'___data__',JSON.stringify({database:db,...e})])]).toString();
const req=(url=listen,body,method=body?'POST':'GET')=>({
  url:()=>url,method:()=>method,postDataBuffer:()=>body?Buffer.from(body):null,
});
const info=(data,start,end,sizes)=>({kind:'listen',events:data,start,end,status:200,sizes});
const sizes={requestBodySize:50,requestHeadersSize:11,responseBodySize:17,responseHeadersSize:9};

test('decodes actual-form Watch ADD and REMOVE without using RunQuery count',()=>{
  const row=inspectRequest(req(listen,frm({addTarget:target},{removeTarget:8})));
  assert.deepEqual(row,{kind:'listen',events:[{type:'add',id:8,homepage:true},{type:'remove',id:8}]});
  assert.deepEqual(inspectRequest(req(listen)),{kind:'listen',events:[]});
  assert.deepEqual(inspectRequest(req(listen+'&'+frm({addTarget:target}),undefined,'GET')), {kind:'listen',events:[{type:'add',id:8,homepage:true}]});
  assert.deepEqual(inspectRequest(req('https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel')),null);
});

test('detects unrecognized forms and excludes non-full or non-home targets',()=>{
  assert.equal(inspectRequest(req(listen,'count=2&ofs=4&req0___data__=bad')).protocolUnknown,true);
  assert.equal(inspectRequest(req(listen,frm({addTarget:{...target,targetId:9,query:{
    ...target.query,structuredQuery:{...target.query.structuredQuery,limit:1}}}}))).events[0].homepage,false);
  assert.equal(inspectRequest(req(listen,frm({addTarget:{targetId:4,documents:{documents:[db+'/documents/users/synthetic']}}}))).events[0].homepage,false);
  assert.equal(inspectRequest(req(listen.replace('demo-bxh','other'),frm({addTarget:target}))).protocolUnknown,true);
});

test('start-inclusive, end-exclusive target observation; complete HTTP bounds',()=>{
  const add={type:'add',id:8,homepage:true},remove={type:'remove',id:8};
  const data=[
    info([add],0,3,sizes),info([],10,20,sizes),info([remove],30,40,sizes),info([add],49,50,sizes),
    info([remove],50,51,sizes),
    {kind:'runQuery',events:[],start:22,end:26,status:200,sizes},
  ];
  const x=summarize(data,10,50);
  assert.deepEqual([x.listenTargets.status,x.listenTargets.homepageAdds,x.listenTargets.homepageRemoves],['measured',1,1]);
  assert.equal(x.http.totalWindowHttpBytes,348);
  assert.equal(x.http.runQueryRequestsStarted,1);
  assert.deepEqual(x.http.completed.runQuery,sizes);
  assert.deepEqual(x.http.completed.listen,Object.fromEntries(Object.entries(sizes).map(([k,v])=>[k,v*3])));
});

test('valid warmed target and zero new commands is not equivalent to zero network',()=>{
  const add={type:'add',id:8,homepage:true};
  const x=summarize([info([add],0,2,sizes),info([],3,14,sizes),info([],15,undefined,null),info([],16,17,sizes)],10,30);
  assert.deepEqual([x.listenTargets.status,x.listenTargets.homepageAdds,x.listenTargets.homepageRemoves],['measured',0,0]);
  assert.equal(x.http.status,'completed-subset-only');
  assert.equal(x.http.boundaryOrOpen,2);
  assert.equal(x.http.totalWindowHttpBytes,null);
  assert.deepEqual(x.http.completed.listen,sizes);
});

test('malformed/ambiguous/missing evidence does not silently report zero',()=>{
  const add={type:'add',id:8,homepage:true};
  const x=summarize([info([add],0,3,sizes),
    {...info([],15,16,sizes),protocolUnknown:true},
    info([{type:'remove',id:987}],17,18,sizes),
    info([add],22,undefined,null), {...info([],23,24,sizes),status:-1}, info([],25,26,{...sizes,responseBodySize:-1})],10,30);
  assert.deepEqual([x.listenTargets.status,x.listenTargets.homepageAdds,x.listenTargets.homepageRemoves],['unmeasurable',null,null]);
  assert.equal(x.listenTargets.unknownRemoval,1);
  assert.equal(x.listenTargets.uncompletedCommands,1);
  assert.equal(x.http.totalWindowHttpBytes,null);
  assert.equal(x.http.missingSizes,1);
  assert.equal(x.http.failedInside,1);
  assert.equal(summarize([],10,30).listenTargets.status,'unmeasurable');
});

test('observer freezes event cutoff before asynchronous size collection',async()=>{
  const ctx=new EventEmitter();
  let t=1,finishLate;
  const wire=attachWireObserver(ctx,()=>t);
  function finish(r,...args){
    const request={...r,response:async()=>({status:()=>200}),sizes:args[0]|| (async()=>sizes)};
    ctx.emit('request',request);return request;
  }
  const warm=finish(req(listen,frm({addTarget:target})));
  t=3;ctx.emit('requestfinished',warm);
  t=11;const a=finish(req(listen),()=>new Promise(r=>finishLate=r));
  t=12;ctx.emit('requestfinished',a);
  t=16;const b=finish(req(listen));
  t=31;ctx.emit('requestfinished',b);
  const x=await wire.report(10,30,() => Promise.resolve());
  assert.equal(x.listenTargets.status,'measured');
  assert.equal(x.http.boundaryOrOpen,1);
  assert.equal(x.http.missingSizes,1);
  assert.equal(x.http.totalWindowHttpBytes,null);
  finishLate(sizes);
});
