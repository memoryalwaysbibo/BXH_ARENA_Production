'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onDocumentDeleted}=require('firebase-functions/v2/firestore');
const {getFirestore}=require('firebase-admin/firestore');
const {getStorage}=require('firebase-admin/storage');
const {betaActorAllowed}=require('./ai-create-core');
const {imageSize}=require('./ai-create-poster-core');
const EventStaff=require('./event-staff-core');
const Fence=require('./bucket-poster-fence.cjs');


const BUCKET='bxh-arena.firebasestorage.app';
const MAX_BYTES=120000;
const MAX_POSTER_BYTES=6*1024*1024;
function invalid(message='invalid-cover'){throw new HttpsError('invalid-argument',message);}
function internal(stage,error){
  if(error instanceof HttpsError)throw error;
  console.error('room-poster-cover-failed',{stage,code:error?.code||'',message:error?.message||''});
  throw new HttpsError('internal',stage+'-failed');
}
function decodeCover(value){
  if(!value||Object.keys(value).sort().join(',')!=='base64,height,mimeType,width'||
     value.mimeType!=='image/jpeg'||value.width!==240||value.height!==240||
     typeof value.base64!=='string'||value.base64.length>160000||
     value.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64))invalid();
  const bytes=Buffer.from(value.base64,'base64');
  if(!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==value.base64)invalid();
  let size;try{size=imageSize(bytes,'image/jpeg');}catch(_){invalid();}
  if(size.width!==240||size.height!==240)invalid();
  return bytes;
}
function decodePoster(value){
  if(!value||Object.keys(value).sort().join(',')!=='base64,height,mimeType,width'||
     !['image/jpeg','image/png'].includes(value.mimeType)||
     !Number.isInteger(value.width)||!Number.isInteger(value.height)||
     value.width<1||value.height<1||value.width>10000||value.height>10000||
     typeof value.base64!=='string'||value.base64.length>Math.ceil(MAX_POSTER_BYTES*4/3)+8||
     value.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64))invalid('invalid-poster');
  const bytes=Buffer.from(value.base64,'base64');
  if(!bytes.length||bytes.length>MAX_POSTER_BYTES||bytes.toString('base64')!==value.base64)invalid('invalid-poster');
  let size;try{size=imageSize(bytes,value.mimeType);}catch(_){invalid('invalid-poster');}
  if(size.width!==value.width||size.height!==value.height)invalid('invalid-poster');
  return {bytes,width:size.width,height:size.height,mimeType:value.mimeType,extension:value.mimeType==='image/png'?'png':'jpg'};
}
function validActor(actor){
  return !!actor&&actor.active===true&&actor.isTestAccount!==true&&actor.deleted!==true&&actor.role!=='tester'
    &&!['deleted','disabled','frozen'].includes(actor.accountStatus);
}
function codeValue(value){
  if(typeof value!=='string'||!/^BXH-[A-Z0-9]{4,24}$/.test(value))invalid('invalid-code');
  return value;
}
function pathUrl(path,token){
  return 'https://firebasestorage.googleapis.com/v0/b/'+BUCKET+'/o/'+encodeURIComponent(path)+'?alt=media&token='+token;
}
function posterPathValid(path,code){
  return typeof path==='string'&&new RegExp('^room-posters/'+code+'/[a-f0-9-]{36}\\.(jpg|png)$').test(path);
}
function coverPathValid(path,code){
  return typeof path==='string'&&new RegExp('^room-covers/'+code+'/[a-f0-9-]{36}\\.jpg$').test(path);
}
async function loadPosterAccess(uid,code,{db=getFirestore(),tx=null}={}){
  const get=ref=>tx?tx.get(ref):ref.get();
  const userRef=db.doc('users/'+uid),privateRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const [actorSnap,roomSnap,pubSnap]=await Promise.all([get(userRef),get(privateRef),get(publicRef)]);
  const actor=actorSnap.exists?actorSnap.data()||{}:null;
  const room=roomSnap.exists?roomSnap.data()||{}:null;
  const pub=pubSnap.exists?pubSnap.data()||{}:null;
  const binding=room&&pub?Fence.binding(roomSnap,pubSnap,code):null;
  let allowed=false;
  if(validActor(actor)&&room&&pub&&room.eventAuthority==='official'&&pub.publishedAt&&pub.visibility==='public'){
    allowed=actor.role==='super_admin'||actor.role==='admin'||room.createdBy===uid;
    if(!allowed){
      const assignmentId=createHash('sha256').update(code+'|'+uid).digest('hex');
      const assignmentRef=db.doc('eventStaffAssignments/'+assignmentId);
      const assignmentSnap=await get(assignmentRef);
      const assignment=assignmentSnap.exists?assignmentSnap.data()||{}:null;
      const embedded=room.eventStaffAssignments&&room.eventStaffAssignments[uid];
      if(assignment&&embedded&&assignment.status==='accepted'&&embedded.status==='accepted'
        &&assignment.targetUid===uid&&assignment.eventCode===code){
        const organizerRef=db.doc('users/'+assignment.organizerUid);
        const organizerSnap=await get(organizerRef);
        const organizer=organizerSnap.exists?organizerSnap.data()||{}:null;
        if(organizer&&Fence.assignmentCurrent(roomSnap,assignmentSnap,embedded))allowed=EventStaff.effective(assignment,Object.assign({uid},actor),
          Object.assign({uid:assignment.organizerUid},organizer),room);
      }
    }
  }
  return {allowed,actor,room,pub,privateRef,publicRef,binding};
}
async function getPosterPermission(request,{db=getFirestore()}={}){
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','auth-required');
  if(process.env.GCLOUD_PROJECT!=='bxh-arena')throw new HttpsError('failed-precondition','production-only');
  const code=codeValue(request.data?.code);
  let access;try{access=await loadPosterAccess(uid,code,{db});}catch(error){if(Fence.known(error))return {ok:true,allowed:false,hasPoster:false,posterUrl:'',coverUrl:''};throw error;}
  return {ok:true,allowed:access.allowed,hasPoster:!!access.pub?.posterUrl,
    posterUrl:access.pub?.posterUrl||'',coverUrl:access.pub?.coverUrl||''};
}
async function savePoster(request,{db=getFirestore(),bucket=getStorage().bucket(BUCKET)}={}){
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','auth-required');
  if(process.env.GCLOUD_PROJECT!=='bxh-arena')throw new HttpsError('failed-precondition','production-only');
  const code=codeValue(request.data?.code);
  const initial=await loadPosterAccess(uid,code,{db});
  if(!initial.allowed)throw new HttpsError('permission-denied','poster-not-allowed');
  const photo=decodePoster(request.data?.photo),cover=decodeCover(request.data?.cover);
  const posterId=randomUUID(),coverId=randomUUID(),posterToken=randomUUID(),coverToken=randomUUID();
  const posterPath='room-posters/'+code+'/'+posterId+'.'+photo.extension;
  const coverPath='room-covers/'+code+'/'+coverId+'.jpg';
  const posterUrl=pathUrl(posterPath,posterToken),coverUrl=pathUrl(coverPath,coverToken);
  const posterFile=bucket.file(posterPath),coverFile=bucket.file(coverPath);
  const metadata=(mime,token)=>({resumable:false,contentType:mime,metadata:{
    cacheControl:'public,max-age=31536000,immutable',metadata:{firebaseStorageDownloadTokens:token}
  }});
  const uploaded=[];
  const cleanupUploaded=()=>Promise.all(uploaded.map(file=>file.delete({ignoreNotFound:true}).catch(()=>{})));
  try{
    uploaded.push(posterFile);await posterFile.save(photo.bytes,metadata(photo.mimeType,posterToken));
  }catch(error){
    await cleanupUploaded();
    internal('poster-image-upload',error);
  }
  try{
    uploaded.push(coverFile);await coverFile.save(cover,metadata('image/jpeg',coverToken));
  }catch(error){
    await cleanupUploaded();
    internal('poster-thumbnail-upload',error);
  }
  let oldPosterPath=null,oldCoverPath=null,prepared=false;
  try{
    await db.runTransaction(async tx=>{
      const access=await loadPosterAccess(uid,code,{db,tx});
      if(!access.allowed||!access.room||!access.pub)throw new HttpsError('permission-denied','poster-not-allowed');
      Fence.same(initial.binding,access.binding);
      oldPosterPath=access.room.posterPath||null;
      oldCoverPath=access.room.coverPath||null;
      const updatedAt=Date.now();
      tx.update(access.privateRef,{posterPath,posterUrl,posterMimeType:photo.mimeType,
        posterWidth:photo.width,posterHeight:photo.height,posterUpdatedAt:updatedAt,
        coverPath,coverUrl,coverUpdatedAt:updatedAt});
      tx.update(access.publicRef,{posterUrl,posterMimeType:photo.mimeType,
        posterWidth:photo.width,posterHeight:photo.height,posterUpdatedAt:updatedAt,coverUrl});
      prepared=true;
    });
  }catch(error){
    const result=prepared?await Fence.outcome(db,initial.privateRef,initial.publicRef,code,initial.binding,{posterPath,posterUrl,coverPath,coverUrl}):'unreferenced';
    if(result==='unreferenced'){await cleanupUploaded();internal('poster-commit',error);}
    if(result!=='confirmed')throw new HttpsError('unavailable','poster-commit-outcome-unknown');
  }
  const cleanup=[];
  if(posterPathValid(oldPosterPath,code)&&oldPosterPath!==posterPath)cleanup.push(bucket.file(oldPosterPath).delete({ignoreNotFound:true}).catch(()=>{}));
  if(coverPathValid(oldCoverPath,code)&&oldCoverPath!==coverPath)cleanup.push(bucket.file(oldCoverPath).delete({ignoreNotFound:true}).catch(()=>{}));
  await Promise.all(cleanup);
  return {ok:true,posterUrl,coverUrl,width:photo.width,height:photo.height,mimeType:photo.mimeType};
}
async function saveCover(request,{db=getFirestore(),bucket=getStorage().bucket(BUCKET)}={}){
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','auth-required');
  if(process.env.GCLOUD_PROJECT!=='bxh-arena')throw new HttpsError('failed-precondition','production-only');
  const code=request.data?.code;
  if(typeof code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(code))invalid();
  const bytes=decodeCover(request.data?.cover);
  const actor=(await db.doc('users/'+uid).get()).data();
  if(!betaActorAllowed(actor)||actor.deleted===true||['deleted','frozen','disabled'].includes(actor.accountStatus))
    throw new HttpsError('permission-denied','cover-not-allowed');
  const privateRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const [privateSnap,publicSnap]=await Promise.all([privateRef.get(),publicRef.get()]);
  if(!privateSnap.exists||!publicSnap.exists||privateSnap.data().createdBy!==uid||
     privateSnap.data().eventAuthority!=='official'||!publicSnap.data().publishedAt)
    throw new HttpsError('permission-denied','room-owner-required');
  const binding=Fence.binding(privateSnap,publicSnap,code);
  const token=randomUUID(),path='room-covers/'+code+'/'+randomUUID()+'.jpg';
  const url=pathUrl(path,token);
  const file=bucket.file(path);
  try{
  await file.save(bytes,{resumable:false,contentType:'image/jpeg',metadata:{cacheControl:'public,max-age=86400',metadata:{firebaseStorageDownloadTokens:token}}});
  }catch(error){await file.delete({ignoreNotFound:true}).catch(()=>{});throw error;}
  let oldPath,prepared=false;
  try{
    await db.runTransaction(async tx=>{
      const [room,pub,currentActor]=await Promise.all([tx.get(privateRef),tx.get(publicRef),tx.get(db.doc('users/'+uid))]);
      const current=currentActor.data();
      if(!betaActorAllowed(current)||current?.deleted===true||['deleted','frozen','disabled'].includes(current?.accountStatus))throw new HttpsError('permission-denied','cover-not-allowed');
      if(!room.exists||!pub.exists||room.data().createdBy!==uid||
         room.data().eventAuthority!=='official'||!pub.data().publishedAt)
        throw new HttpsError('permission-denied','room-owner-required');
      Fence.same(binding,Fence.binding(room,pub,code));
      oldPath=room.data().coverPath;
      tx.update(privateRef,{coverPath:path,coverUrl:url,coverUpdatedAt:Date.now()});
      tx.update(publicRef,{coverUrl:url});
      prepared=true;
    });
  }catch(error){
    const result=prepared?await Fence.outcome(db,privateRef,publicRef,code,binding,{coverPath:path,coverUrl:url}):'unreferenced';
    if(result==='unreferenced'){await file.delete({ignoreNotFound:true}).catch(()=>{});throw error;}
    if(result!=='confirmed')throw new HttpsError('unavailable','poster-commit-outcome-unknown');
  }
  if(coverPathValid(oldPath,code)&&oldPath!==path)await bucket.file(oldPath).delete({ignoreNotFound:true}).catch(()=>{});
  return {ok:true,url};
}
async function handleRoomPosterCover(request,options={}){
  if(request.data?.action==='canManage')return getPosterPermission(request,options);
  if(request.data?.action==='savePoster')return savePoster(request,options);
  return saveCover(request,options);
}
exports.roomPosterCover=onCall({region:'asia-east1',cors:true,maxInstances:3,memory:'512MiB'},handleRoomPosterCover);
exports.roomPosterCoverCleanup=onDocumentDeleted({document:'tournaments/{code}',region:'asia-east1'},async event=>{
  const data=event.data?.data()||{},code=event.params.code,bucket=getStorage().bucket(BUCKET);
  if(typeof code!=='string'||!/^BXH-[A-Z0-9]{4,24}$/.test(code))return;
  const paths=[data.coverPath,data.posterPath];
  await Promise.all(paths.map(path=>{
    if(coverPathValid(path,code)||posterPathValid(path,code))return bucket.file(path).delete({ignoreNotFound:true});
    return Promise.resolve();
  }));
});
exports._test={decodeCover,decodePoster,loadPosterAccess,getPosterPermission,savePoster,saveCover,handleRoomPosterCover};
