import {collection,doc,getDocFromServer,onSnapshot,query,orderBy,limitToLast} from 'firebase/firestore';
// ONLY constructed by demo runner after connectFirestoreEmulator.
export function sdkTransport(db){
 return {
  subscribe(room,callback,onError){
   let resolve,reject;const ready=new Promise((r,j)=>{resolve=r;reject=j;});
   const stop=onSnapshot(query(collection(db,'labRooms',room,'deltas'),orderBy('revision'),limitToLast(128)),{includeMetadataChanges:true},snap=>{
    if(snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;
    for(const change of snap.docChanges())if(change.type!=='removed')callback(JSON.parse(change.doc.data().packet));
    resolve();
   },error=>{reject(error);onError(error);});
   return {ready,stop(){stop();resolve();}};
  },
  legacy(room,callback,onError=()=>{}){return onSnapshot(doc(db,'labRooms',room,'public','legacy'),{includeMetadataChanges:true},snap=>{if(snap.exists()&&!snap.metadata.fromCache&&!snap.metadata.hasPendingWrites)callback(JSON.parse(snap.data().view));else if(!snap.exists()&&!snap.metadata.fromCache)onError(Object.assign(Error('not-found'),{code:'not-found'}));},onError);},
  async checkpoint(room){const snap=await getDocFromServer(doc(db,'labRooms',room,'public','checkpoint'));if(!snap.exists())throw Error('checkpoint-missing');return JSON.parse(snap.data().packet);}
 };
}
