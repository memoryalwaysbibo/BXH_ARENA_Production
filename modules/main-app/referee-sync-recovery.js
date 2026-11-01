(function(root){
'use strict';
let busy=false,serial=0;
const prefix='bxh-referee-sync-recovery:';
function scope(uid,code){if(typeof uid!=='string'||!uid||typeof code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-context');return prefix+uid+':'+code;}
async function backupAndReload({snapshot,uid,code,storage,isCurrent,readRemote,cacheRemote,reload,now=Date.now,timeoutMs=8000}){
 if(busy)return {ok:false,reason:'busy'};
 busy=true;
 try{
  const base=scope(uid,code);
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('invalid-timeout');
  const step=async task=>{let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('recovery-timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}};
  if(!snapshot?.id||snapshot.cloudCode!==code||!storage?.set||!storage?.get||typeof isCurrent!=='function'||typeof readRemote!=='function'||typeof cacheRemote!=='function'||typeof reload!=='function')throw Error('invalid-context');
  if(!isCurrent())return {ok:false,reason:'context-changed'};
  const at=now(),nonce=root.crypto?.randomUUID?.()||Math.random().toString(36).slice(2),key=base+':'+at+':'+(++serial)+':'+nonce;
  const value=JSON.stringify({type:'bxh-referee-sync-recovery-v1',uid,code,savedAt:at,snapshot});
  if(await step(storage.set(key,value))===false)throw Error('backup-failed');
  if((await step(storage.get(key)))?.value!==value)throw Error('backup-unverified');
  // Pointer is only for retrieval. The unique verified backup remains even if this fails.
  if(await step(storage.set(base+':latest',key))===false)throw Error('backup-index-failed');
  if((await step(storage.get(base+':latest')))?.value!==key)throw Error('backup-index-unverified');
  if(!isCurrent())return {ok:false,reason:'context-changed',backupKey:key};
  const result=await step(readRemote());
  if(!result?.ok)throw Error('remote-read-failed');
  const remote=result.data;
  if(!remote||remote.id!==snapshot.id||(remote.cloudCode!=null&&remote.cloudCode!==code)||!remote.meta||!Array.isArray(remote.matches)||!Array.isArray(remote.players))throw Error('remote-context-mismatch');
  if(!isCurrent())return {ok:false,reason:'context-changed',backupKey:key};
  if(await step(cacheRemote({...remote,cloudCode:code}))!==true)throw Error('remote-cache-failed');
  if(!isCurrent())return {ok:false,reason:'context-changed',backupKey:key};
  reload();
  return {ok:true,backupKey:key};
 }catch(error){return {ok:false,reason:error?.message||'backup-failed'};}
 finally{busy=false;}
}
async function latest({uid,code,storage}){
 const base=scope(uid,code),key=(await storage.get(base+':latest'))?.value;
 if(typeof key!=='string'||!key.startsWith(base+':'))return null;
 const raw=(await storage.get(key))?.value;if(typeof raw!=='string')return null;
 const data=JSON.parse(raw);
 if(data.type!=='bxh-referee-sync-recovery-v1'||data.uid!==uid||data.code!==code||data.snapshot?.cloudCode!==code||!data.snapshot?.id)throw Error('backup-context-mismatch');
 return data;
}
const api={backupAndReload,latest,isBusy:()=>busy};
if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHRefereeSyncRecovery=api;
})(typeof window==='object'?window:globalThis);
