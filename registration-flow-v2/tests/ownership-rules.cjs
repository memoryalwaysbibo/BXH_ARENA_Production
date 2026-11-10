'use strict';

const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {test}=require('node:test');
const {composeRules}=require('../backend/compose-rules.cjs');
const {db,FieldValue}=require('./harness.cjs');

const project='demo-bxh-registration-v2';
const emulator='http://127.0.0.1:8197';
const documents=`/v1/projects/${project}/databases/(default)/documents`;
const baseline=process.env.BXH_REGISTRATION_V2_RULES_BASELINE||join(__dirname,'../../referee-seats/reference/firestore.production-20261104.rules');
const original=readFileSync(baseline,'utf8');
const code='BXH-RULESFENCE';
const privatePath=`tournaments/${code}`;
const publicPath=`publicTournaments/${code}`;
const registration=`${privatePath}/registrations/player`;
const participant=`${privatePath}/participants/local`;
const journal=`_registrationQueueV2/${code}`;
const job=`${journal}/_registrationQueueJobsV2/operation`;

function token(uid){
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const now=Math.floor(Date.now()/1000);
 return encode({alg:'none',typ:'JWT'})+'.'+encode({aud:project,iss:`https://securetoken.google.com/${project}`,
  sub:uid,user_id:uid,iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:'custom',identities:{}}})+'.';
}

async function request(path,method,expected,{uid,body}={}){
 const headers=body?{'Content-Type':'application/json'}:{};
 if(uid)headers.Authorization=`Bearer ${token(uid)}`;
 const response=await fetch(emulator+path,{method,headers,body:body&&JSON.stringify(body)});
 const result=await response.json();
 assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(result)}`);
 return result;
}

function update(path,fields,status=200,uid='admin'){
 const mask=new URLSearchParams(Object.keys(fields).map(key=>['updateMask.fieldPaths',key]));
 return request(`${documents}/${path}?${mask}`,'PATCH',status,{uid,body:{fields}});
}

function writeRoomPair(privateFields,publicFields,status){
 const writes=[[privatePath,privateFields],[publicPath,publicFields]].map(([path,fields])=>({
  update:{name:`projects/${project}/databases/(default)/documents/${path}`,fields},
  updateMask:{fieldPaths:Object.keys(fields)},
 }));
 return request(`${documents}:commit`,'POST',status,{uid:'admin',body:{writes}});
}

async function install(rules){
 const result=await request(`/emulator/v1/projects/${project}:securityRules`,'PUT',200,{
  body:{rules:{files:[{name:'firestore.rules',content:rules}]}},
 });
 assert.deepEqual((result.issues||[]).filter(issue=>issue.severity==='ERROR'),[]);
}

test('the reviewed rules fence closes browser writes only while the server owns the room',async()=>{
 assert.throws(()=>composeRules(original+'\n'),/Unreviewed Firestore Rules baseline/);
 const room={eventAuthority:'official',createdBy:'admin',ownerUid:'admin',createdByRole:'super_admin',
  visibility:'public',ladderMode:'general',tournamentPhase:'waiting',archiveStatus:'ongoing',
  registrationEnabled:false,registrationStatus:'closed',confirmedCount:0,waitlistCount:0,updatedAt:1};
 const batch=db.batch();
 batch.set(db.doc('users/admin'),{active:true,role:'super_admin'});
 batch.set(db.doc('users/player'),{active:true,role:'player'});
 batch.set(db.doc(privatePath),{...room,data:'{}',registrationQueueVersion:2});
 batch.set(db.doc(publicPath),{...room,bracketView:'{}'});
 batch.set(db.doc(registration),{uid:'player',status:'confirmed'});
 batch.set(db.doc(participant),{name:'Local fixture'});
 batch.set(db.doc(journal),{until:0});
 batch.set(db.doc(job),{state:'queued'});
 await batch.commit();

 const privateEdit={data:{stringValue:'{"players":[{"id":"legacy"}]}'},updatedAt:{integerValue:'2'}};
 const publicEdit={bracketView:{stringValue:'{"players":[{"id":"legacy"}]}'},updatedAt:{integerValue:'2'}};
 await install(original);
 await update(privatePath,privateEdit);
 await update(publicPath,publicEdit);

 await install(composeRules(original));
 const stalePrivate={...privateEdit,data:{stringValue:'{"players":[]}'}};
 const stalePublic={...publicEdit,bracketView:{stringValue:'{"players":[]}'}};
 await update(privatePath,stalePrivate,403);
 await update(publicPath,stalePublic,403);
 const drawn={stringValue:'{"bracketSize":2,"matches":[{"id":"match-1"}]}'};
 const started={stringValue:'{"bracketSize":2,"matches":[{"id":"match-1"}],"startedAt":3}'};
 const drawPrivate={data:drawn,bracketSize:{integerValue:'2'},updatedAt:{integerValue:'3'}};
 const drawPublic={bracketView:drawn,updatedAt:{integerValue:'3'}};
 const startFields={tournamentPhase:{stringValue:'live'},registrationStatus:{stringValue:'started'},updatedAt:{integerValue:'4'}};
 await writeRoomPair(drawPrivate,drawPublic,403);
 await writeRoomPair({data:started,...startFields},{bracketView:started,...startFields},403);
 assert.equal((await db.doc(privatePath).get()).data().tournamentPhase,'waiting');
 assert.equal((await db.doc(publicPath).get()).data().tournamentPhase,'waiting');
 await update(participant,{name:{stringValue:'Attempted overwrite'}},403);
 for(const path of [registration,publicPath,privatePath]){
  await request(`${documents}/${path}`,'DELETE',403,{uid:'admin'});
 }
 await request(`${documents}/${registration}`,'GET',200,{uid:'player'});
 await request(`${documents}/${publicPath}`,'GET',200);
 for(const path of [journal,job]){
  for(const uid of ['admin','player'])await request(`${documents}/${path}`,'GET',403,{uid});
  await update(path,{state:{stringValue:'completed'}},403);
 }

 await db.doc(publicPath).delete();
 await update(publicPath,{bracketView:{stringValue:'{}'},visibility:{stringValue:'public'},updatedAt:{integerValue:'3'},
  confirmedCount:{integerValue:'0'},waitlistCount:{integerValue:'0'}},403);
 await db.doc(publicPath).set({...room,bracketView:'{}'});
 await db.doc(privatePath).update({registrationQueueVersion:FieldValue.delete()});

 await update(privatePath,{registrationQueueVersion:{integerValue:'2'}},403);
 await update(`${privatePath}-FORGED`,{registrationQueueVersion:{integerValue:'2'}},403);
 await update(`${privatePath}-PLAIN`,{data:{stringValue:'{}'}});
 await update(publicPath,{registrationQueueVersion:{integerValue:'2'}},403);
 await update(privatePath,{...stalePrivate,updatedAt:{integerValue:'4'}});
 await update(publicPath,{...publicEdit,updatedAt:{integerValue:'4'}});
 await update(participant,{name:{stringValue:'Legacy write restored'}});
 await request(`${documents}/${registration}`,'DELETE',200,{uid:'admin'});
 await writeRoomPair(drawPrivate,drawPublic,200);
 await writeRoomPair({data:started,...startFields},{bracketView:started,...startFields},200);
});
