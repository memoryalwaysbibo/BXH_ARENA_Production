import {initializeApp} from 'firebase/app';import {initializeFirestore,connectFirestoreEmulator} from 'firebase/firestore';
import {spectatorTransport} from './spectator-transport.mjs';import {createSpectator} from './spectator-lifecycle.mjs';import schema from './public-schema.cjs';import {render} from './arena-renderers.mjs';
const mode=new URL(location.href).searchParams.get('mode');window.engineLab={mode,view:null,revision:null,states:[]};
function show(v){engineLab.view=v;document.querySelector('#arena').innerHTML=render(v,mode);}
if(mode==='referee'){
 show(await(await fetch('/state')).json());
 document.querySelector('#arena').addEventListener('click',async event=>{const b=event.target.closest('button[data-action]');if(!b||b.disabled)return;
 const map={'score':'score','undo-score':'undo','confirm-result':'confirm','skip-match':'skip'};const action=map[b.dataset.action];if(!action)return;
 b.disabled=true;const r=await fetch('/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:b.dataset.id,side:b.dataset.side,finish:b.dataset.type})});
 const out=await r.json();if(!r.ok){engineLab.error=out.error;return;}show(out.view);engineLab.revision=out.revision;
 });
}else{
 const app=initializeApp({projectId:'demo-arena-public-delta',apiKey:'demo',appId:'demo-engine-ui'}),db=initializeFirestore(app,{});connectFirestoreEmulator(db,'127.0.0.1',18786);
 const watcher=createSpectator({transport:spectatorTransport(db),validateView:schema.validate,onClear(){document.querySelector('#arena').innerHTML='';},onView:(v,m)=>{show(v);engineLab.revision=m.revision??engineLab.revision;},onStatus:s=>engineLab.states.push(s)});
 await watcher.setContext({route:'spectator',hidden:false,identity:'demo-observer',room:'engine96',epoch:'e-engine96'});engineLab.watcher=watcher;
}
engineLab.ready=true;
