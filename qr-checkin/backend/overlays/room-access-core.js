'use strict';
const {randomBytes,scryptSync,timingSafeEqual}=require('node:crypto');

const ACCESS_MODES=new Set(['public','password']);
const ACCESS_GRANT_MS=12*60*60*1000;
const ATTEMPT_WINDOW_MS=15*60*1000;
const ATTEMPT_LOCK_MS=10*60*1000;
const MAX_FAILED_ATTEMPTS=5;

const active=p=>!!p&&p.active===true&&!p.deleted&&!['deleted','disabled','frozen'].includes(p.accountStatus);
const normalizeCode=v=>String(v||'').trim().toUpperCase();
const validCode=v=>/^BXH-[A-Z0-9]{4,16}$/.test(normalizeCode(v));
const normalizeMode=v=>ACCESS_MODES.has(String(v||''))?String(v):'public';
function normalizePassword(value){
 const s=String(value??'').normalize('NFKC').trim();
 if([...s].length<4||[...s].length>20||/[\u0000-\u001f\u007f]/.test(s))throw Error('invalid-room-password');
 return s;
}
const passwordDigest=(password,salt)=>scryptSync(normalizePassword(password),Buffer.from(salt,'hex'),32);
function createPasswordRecord(password){
 const salt=randomBytes(16).toString('hex');
 return {salt,hash:passwordDigest(password,salt).toString('hex')};
}
function verifyPassword(password,salt,expectedHex){
 try{
  const actual=passwordDigest(password,salt),expected=Buffer.from(String(expectedHex||''),'hex');
  return expected.length===actual.length&&timingSafeEqual(actual,expected);
 }catch{return false;}
}
const isOwner=(uid,t)=>!!uid&&t?.eventAuthority==='community'&&(t.ownerUid===uid||t.createdBy===uid);
const isSuperAdmin=p=>active(p)&&p.role==='super_admin'&&p.isTestAccount!==true;
const canBypass=(uid,p,t)=>isOwner(uid,t)||isSuperAdmin(p);
const grantValid=(grant,t,now=Date.now())=>!!grant&&Number(grant.accessVersion)===Number(t?.roomAccessVersion||0)&&Number(grant.expiresAt||0)>now;
function parseState(t){try{return JSON.parse(t?.data||'{}');}catch{return {};}}
function roomUnlockedForConfig(t){
 const s=parseState(t),phase=String(t?.tournamentPhase||'waiting');
 return !t?.systemClosed&&!s.startedAt&&!s.bracketSize&&!(s.matches||[]).some(m=>!m?.isBye)&&!['live','settling','done','cancelled'].includes(phase)&&s.archiveStatus!=='completed';
}
module.exports={
 ACCESS_GRANT_MS,ATTEMPT_WINDOW_MS,ATTEMPT_LOCK_MS,MAX_FAILED_ATTEMPTS,
 active,normalizeCode,validCode,normalizeMode,normalizePassword,createPasswordRecord,verifyPassword,
 isOwner,isSuperAdmin,canBypass,grantValid,parseState,roomUnlockedForConfig
};
