'use strict';
const {createHash}=require('node:crypto');
const {MockDB,user}=require('../referee-certificates/test/mock-db.cjs');
const {createService}=require('../referee-certificates/functions/service.cjs');
const counts=[244,25,108,152,171,298,90,91,0,33,22,276,108,159,49,32,31,77];
const hash=s=>createHash('sha256').update(s).digest('hex');
function makePlan(){return {mode:'READ_ONLY_PREVIEW_NOT_APPLIED',people:counts.map((count,i)=>{
 const uid='legacy_fixture_'+i,sourceMap={};
 for(let j=0;j<count;j++){const code='BXH-TEST',match='m'+j,key='historical:legacy_'+hash(JSON.stringify([uid,code,match]));sourceMap[key]=[{document:'projects/bxh-arena/databases/(default)/documents/staffActivityLogs/'+uid+'/matches/'+code+'_'+match,tournamentCode:code,matchId:match}];}
 const keys=Object.keys(sourceMap).sort(),batches=[];
 for(let j=0;j<count;j+=200){const selected=keys.slice(j,j+200);batches.push({batch:batches.length+1,entry:{kind:'decision',decisions:selected.length,events:0,auxiliary:0,size:null,precision:'unknown',sourceKey:selected[0],sourceKeys:selected,sourceUid:null,period:'fixture',basis:'explicit legacy authorization fixture',note:''}});}
 return {order:i+1,uid,name:'Fixture '+(i+1),personId:'initial-'+String(i+1).padStart(2,'0'),count,sourceMap,batches};
})};}
function setup(){const plan=makePlan(),owner=plan.people[0].uid;
 const seed={'systemConfig/refereeCertificatesV1':{enabled:true,publicSummaryEnabled:false,initialRosterApproved:true},'refereeCertificateSystem/numbering':{lastIssuedNumber:18}};
 for(const p of plan.people){seed['users/'+p.uid]=user(p.uid===owner?'super_admin':'player');seed['refereeCertificates/'+p.uid]={number:'R'+String(p.order).padStart(6,'0'),personId:p.personId,awardedLevel:1,qualificationStatus:'active',revision:2,issuedAt:1,approvedBy:owner,approvedAt:1,photoDataUrl:p.uid===owner?'existing-photo':null};}
 const db=new MockDB(seed),handle=createService(db),map=new Map();let actor=owner,mutations=0;
 return {plan,owner,db,setActor:v=>actor=v,mutations:()=>mutations,storage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},call:async data=>{if(data.action==='saveBackfill')mutations++;return handle({auth:{uid:actor},data});}};
}
module.exports={makePlan,setup,hash};
