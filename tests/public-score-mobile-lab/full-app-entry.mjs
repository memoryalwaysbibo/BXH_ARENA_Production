import {initializeApp} from 'firebase/app';
import {initializeFirestore,connectFirestoreEmulator} from 'firebase/firestore';
import {spectatorTransport} from './spectator-transport.mjs';
import {createSpectator} from './spectator-lifecycle.mjs';
import schema from './public-schema.cjs';
if(location.hostname!=='127.0.0.1'||new URL(location.href).searchParams.get('bxh_e2e')!=='1')throw Error('lab-only-localhost');
const app=initializeApp({projectId:'demo-arena-public-delta',apiKey:'demo',appId:'demo-full-app'},'full-app-public-lab');
const db=initializeFirestore(app,{});connectFirestoreEmulator(db,'127.0.0.1',18786);
let context={},session=null,signature='',suspended=false;
const evidence={contexts:[],states:[],renders:0,privateTouched:false,view:null};
function reconcile(){
 if(!session)return;
 const eligible=context.phase==='app'&&['bracket','live'].includes(context.tab)&&!context.private&&context.room===session.room;
 const next={route:eligible?'spectator':'other',hidden:document.hidden||suspended,identity:context.identity||'guest',room:session.room,epoch:'e-'+session.room};
 const key=JSON.stringify(next);if(key===signature)return;signature=key;evidence.contexts.push(next);void session.watcher.setContext(next);
}
window.BXHFullAppLab={evidence,context(next){context=next;reconcile();},subscribe(room,baseline,apply,clear){
 session?.watcher.close();signature='';let closed=false;
 const watcher=createSpectator({transport:spectatorTransport(db),validateView:schema.validate,
 onClear(){evidence.view=null;if(!closed){clear();}},
 onView(view,meta){if(closed)return;evidence.renders++;evidence.view=view;evidence.revision=meta.revision;apply({...structuredClone(baseline),...view,meta:{...baseline.meta,...view.meta}},true);},
 onStatus(s){evidence.states.push(s);}});
 session={room,watcher};reconcile();return()=>{closed=true;watcher.close();if(session?.watcher===watcher)session=null;};
}};
document.addEventListener('visibilitychange',reconcile);
window.addEventListener('pagehide',()=>{suspended=true;reconcile();});
window.addEventListener('pageshow',()=>{suspended=false;reconcile();});
