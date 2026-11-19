import {doc,getDocFromServer,onSnapshot} from 'firebase/firestore';
import {sdkTransport} from './sdk-transport.mjs';
export function spectatorTransport(db){return {...sdkTransport(db),
 async authorize(room){const s=await getDocFromServer(doc(db,'labRooms',room));if(!s.exists()||s.data().visibility!=='public')throw Error('not-public');},
 watchAccess(room,revoke,error){return onSnapshot(doc(db,'labRooms',room),{includeMetadataChanges:true},s=>{if(!s.metadata.fromCache&&(!s.exists()||s.data().visibility!=='public'))revoke();},error);}
};}
