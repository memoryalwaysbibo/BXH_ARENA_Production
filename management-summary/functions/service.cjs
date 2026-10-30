'use strict';

const {activeAccount,ownsEvent,effective}=require('./event-staff-core.cjs');
const PAGE_SIZE=5;
// Deliberately excludes data, bracketView, registrations, match logs, seat maps,
// contact details and scoring fields. Projection happens inside Firestore.
const FIELDS=Object.freeze(['name','eventDate','startAt','location','posterUrl','battleMode','teamSize',
 'formatType','ladderMode','testLadderEnabled','ladderPointsAwarded','tournamentPhase','archiveStatus',
 'registrationEnabled','registrationStatus','registrationOpenAt','registrationCloseAt','publishedAt',
 'eventCancelled','capacity','confirmedCount','registeredCount','waitlistEnabled','waitlistCapacity','waitlistCount',
 'updatedAt','createdBy','createdByName','eventAuthority','ownerUid','testMode','createdByRole',
 'partnerOrganizationCode','partnerContractOrderCode','systemClosed','deletionStatus']);
const tidy=(value,max=160)=>String(value??'').slice(0,max);
const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
function millis(value){
 if(value==null||value==='')return null;
 if(typeof value?.toMillis==='function')return value.toMillis();
 if(typeof value==='object'&&Number.isFinite(value.seconds))return value.seconds*1000;
 const number=Number(value);return Number.isFinite(number)?number:Number.isFinite(Date.parse(value))?Date.parse(value):null;
}
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
function registrationStatus(d,now){
 const raw=({upcoming:'scheduled',openingSoon:'scheduled',started:'closed'})[d.registrationStatus]||d.registrationStatus;
 if(d.eventCancelled===true||raw==='cancelled')return 'cancelled';
 if(d.systemClosed===true||d.archiveStatus==='completed'||['live','settling','done','cancelled'].includes(d.tournamentPhase))return 'closed';
 if(raw==='draft'||(!raw&&!d.publishedAt))return 'draft';
 if(d.registrationEnabled===false||raw==='closed')return 'closed';
 const close=millis(d.registrationCloseAt),open=millis(d.registrationOpenAt);
 if(close!==null&&now>=close)return 'closed';
 if(open!==null&&now<open)return 'scheduled';
 if(count(d.capacity)>0&&count(d.confirmedCount)>=count(d.capacity))return 'full';
 if(open!==null&&now>=open)return 'open';
 return ['open','full','scheduled'].includes(raw)?raw:'draft';
}
const bucket=status=>status==='scheduled'?'upcoming':['closed','cancelled'].includes(status)?'closed':status==='draft'?'draft':'open';
function project(code,d,now){
 const status=registrationStatus(d,now);
 return {code,name:tidy(d.name),eventDate:tidy(d.eventDate,32),startAt:tidy(d.startAt,32),location:tidy(d.location,240),
  posterUrl:typeof d.posterUrl==='string'&&d.posterUrl.length<=2048&&/^https?:\/\//.test(d.posterUrl)?d.posterUrl:'',
  battleMode:d.battleMode==='team'?'team':'individual',teamSize:Math.max(3,count(d.teamSize)),formatType:tidy(d.formatType,32),
  ladderMode:d.ladderMode==='ranked'?'ranked':'general',testLadderEnabled:d.testLadderEnabled===true,
  ladderPointsAwarded:d.ladderPointsAwarded===true,tournamentPhase:tidy(d.tournamentPhase||'waiting',32),archiveStatus:tidy(d.archiveStatus||'ongoing',32),
  registrationEnabled:d.registrationEnabled===true,registrationStatus:status,registrationBucket:bucket(status),
  capacity:count(d.capacity),confirmedCount:count(d.confirmedCount),registeredCount:count(d.registeredCount),
  waitlistEnabled:d.waitlistEnabled===true,waitlistCapacity:count(d.waitlistCapacity),waitlistCount:count(d.waitlistCount),
  updatedAt:millis(d.updatedAt)||0,createdBy:tidy(d.createdBy,128),createdByName:tidy(d.createdByName),
  eventAuthority:tidy(d.eventAuthority||'official',32),testMode:d.testMode===true,createdByRole:tidy(d.createdByRole,32)};
}
function compare(a,b){return a.eventDate===b.eventDate?b.updatedAt-a.updatedAt||a.code.localeCompare(b.code):a.eventDate<b.eventDate?1:-1;}
function options(data={}){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid-argument');
 const status=data.status||'open',kind=data.kind||'official',mode=data.mode||'admin';
 if(!['open','upcoming','closed','draft','all'].includes(status)||!['official','community'].includes(kind)
  ||!['admin','partner_organizer','event_staff'].includes(mode)||typeof(data.search??'')!=='string'||data.search?.length>120)throw Error('invalid-argument');
 if(data.cursor!=null&&(typeof data.cursor!=='string'||data.cursor.length>2000))throw Error('invalid-cursor');
 return {status,kind,mode,search:norm(data.search||''),cursor:data.cursor||null};
}
function partnerGrant(profile,now){
 const g=profile.partnerOrganizer;
 if(!activeAccount(profile)||profile.role!=='player'||g?.status!=='active'||!String(g.organizationId||'').trim())throw Error('permission-denied');
 const start=millis(g.startsAtMs??g.startsAt),expiry=millis(g.expiresAtMs??g.expiresAt);
 if((g.scope==='contract'&&start===null)||(start!==null&&(start<0||start>now))||expiry===null||expiry<=now||expiry<=(start||0))throw Error('permission-denied');
 const order=g.orderCode||g.contractOrderCode||profile.partnerContractOrderCode||null;
 if(g.scope==='contract'&&!order)throw Error('permission-denied');
 return {...g,order};
}
function createSummaryHandler(db,{now=Date.now}={}){return async request=>{
 const uid=request.auth?.uid;if(!uid)throw Error('unauthenticated');
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('permission-denied');
 const opt=options(request.data),at=now();
 return db.runTransaction(async tx=>{
  const userSnap=await tx.get(db.doc('users/'+uid));
  if(!userSnap.exists)throw Error('permission-denied');
  const user=userSnap.data();
  if(user.active!==true||user.deleted===true||['deleted','disabled','frozen'].includes(user.accountStatus))throw Error('permission-denied');
  const tester=user.role==='tester'||user.isTestAccount===true;
  const admin=!tester&&['admin','super_admin'].includes(user.role);
  const staff=!tester&&user.role==='staff';
  let grant=null,scope='';let query=db.collection('tournaments');
  if(opt.mode==='partner_organizer'){
   grant=partnerGrant(user,at);scope='partner:'+grant.organizationId+':'+(grant.order||'');
   query=query.where('createdBy','==',uid).where('createdByRole','==','partner_organizer')
    .where('eventAuthority','==','official').where('partnerOrganizationCode','==',grant.organizationId)
    .where('partnerContractOrderCode','==',grant.order);
  }else if(opt.mode==='event_staff'){
   if(!activeAccount(user)||user.role!=='player')throw Error('permission-denied');
   scope='event_staff';query=query.where('eventStaffAssignments.'+uid+'.status','==','accepted');
  }else if(tester){scope='tester';query=query.where('createdBy','==',uid).where('eventAuthority','==','test');}
  else if(admin||staff)scope=user.role;
  else throw Error('permission-denied');
  if(opt.kind==='community'&&!admin)throw Error('permission-denied');
  const ownerProfile=grant?{...user,partnerOrganizer:{...user.partnerOrganizer,orderCode:grant.order}}:user;
  const fields=opt.mode==='event_staff'?[...FIELDS,'eventStaffAssignments.'+uid]:FIELDS;
  const snapshot=await tx.get(query.select(...fields));
  let docs=snapshot.docs.map(doc=>({code:doc.id,data:doc.data()}));
  if(opt.mode==='event_staff'){
   const parents=new Map();
   for(const creator of [...new Set(docs.map(row=>row.data.createdBy).filter(Boolean))]){
    const parent=await tx.get(db.doc('users/'+creator));parents.set(creator,parent.exists?parent.data():null);
   }
   docs=docs.filter(row=>effective(row.data.eventStaffAssignments?.[uid],{...user,uid},parents.get(row.data.createdBy),row.data,at));
  }
  let rows=docs.filter(({data:d})=>d.deletionStatus!=='deleting'
   &&(opt.kind==='community'?d.eventAuthority==='community':d.eventAuthority!=='community')
   &&(!tester||(d.testMode===true&&d.createdBy===uid&&d.eventAuthority==='test'))
   &&(!grant||ownsEvent(ownerProfile,uid,d,at))).map(({code,data})=>project(code,data,at));
  rows=rows.filter(row=>row.name.trim()||row.eventDate.trim()||row.location.trim()||row.registrationEnabled
   ||row.confirmedCount||row.waitlistCount||row.tournamentPhase!=='waiting');
  if(opt.search)rows=rows.filter(row=>[row.name,row.code,row.location].some(value=>norm(value).includes(opt.search)));
  const counts={all:rows.length,open:0,upcoming:0,closed:0,draft:0};
  rows.forEach(row=>counts[row.registrationBucket]++);
  rows=rows.filter(row=>opt.status==='all'||row.registrationBucket===opt.status).sort(compare);
  const scopeKey=JSON.stringify([uid,scope,opt.mode,opt.kind,opt.status,opt.search]);
  if(opt.cursor){
   let cursor;try{cursor=JSON.parse(Buffer.from(opt.cursor,'base64url').toString('utf8'));}catch{throw Error('invalid-cursor');}
   if(cursor.scope!==scopeKey||typeof cursor.after?.code!=='string'||typeof cursor.after?.eventDate!=='string'
    ||!Number.isFinite(cursor.after?.updatedAt))throw Error('invalid-cursor');
   rows=rows.filter(row=>compare(row,cursor.after)>0);
  }
  const items=rows.slice(0,PAGE_SIZE),hasMore=rows.length>PAGE_SIZE,last=items.at(-1);
  const nextCursor=hasMore?Buffer.from(JSON.stringify({scope:scopeKey,after:{code:last.code,eventDate:last.eventDate,updatedAt:last.updatedAt}})).toString('base64url'):null;
  return {ok:true,items,counts,hasMore,nextCursor,pageSize:PAGE_SIZE,asOf:at};
 });
};}
module.exports={FIELDS,PAGE_SIZE,registrationStatus,project,compare,createSummaryHandler};
