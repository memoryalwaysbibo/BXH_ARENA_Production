'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8');
const scanner=source.slice(source.indexOf('function parseScannedTournamentEntry('),source.indexOf('/* ==== registration QR deep-link'));
const modal=source.slice(source.indexOf('function qrScannerModalMarkup(){'),source.indexOf('\nfunction ',source.indexOf('function syncQrScannerModal(){')+30));
const lifecycle=source.slice(source.indexOf('// Release the check-in camera when Safari/PWA leaves the foreground.'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup({pending=false,playPending=false,playError=false,decoder=true}={}){
  const nodes=new Map(),frames=new Map(),timers=new Map(),handlers={},calls={media:0,play:0,stop:0,accepted:[],routed:[]};
  let next=0,resolveMedia,now=0;
  const stream={getTracks:()=>[{stop(){calls.stop++;}}]};
  function host(){return {id:'',innerHTML:'',remove(){nodes.clear();}};}
  const document={hidden:false,getElementById:id=>nodes.get(id)||null,createElement:()=>host(),addEventListener(type,fn){handlers[type]=fn;},body:{appendChild(h){
    nodes.set(h.id,h);
    nodes.set('qr-scanner-video',{readyState:2,videoWidth:640,videoHeight:480,srcObject:null,pause(){},play(){calls.play++;return playError?Promise.reject(Error('blocked')):playPending?new Promise(()=>{}):Promise.resolve();}});
    nodes.set('qr-scanner-canvas',{getContext:()=>({drawImage(){},getImageData:()=>({data:[],width:640,height:480})})});
    nodes.set('qr-scanner-status',{textContent:'',style:{}});
  }}};
  const window={location:{href:'https://arena.test/'},addEventListener(type,fn){handlers[type]=fn;},BXHQrCheckin:{
    parseUrl(raw){try{const u=new URL(raw);return u.origin==='https://arena.test'&&u.searchParams.get('checkinToken')?{code:u.searchParams.get('checkin'),token:u.searchParams.get('checkinToken')}:null;}catch{return null;}},
    acceptUrl(raw){calls.accepted.push(raw);return true;}
  }};
  if(decoder)window.jsQR=()=>null;
  const context={window,document,URL,Date:{now:()=>now},console,
    navigator:{mediaDevices:{getUserMedia(){calls.media++;return pending?new Promise(resolve=>{resolveMedia=resolve;}):Promise.resolve(stream);}}},
    requestAnimationFrame(fn){const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},
    setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    esc:String,normalizeRoomCodeInput:v=>String(v).trim().toUpperCase(),isValidRoomCode:v=>/^BXH-[A-Z0-9]{4,16}$/.test(v),normalizeTournamentEntryType:v=>v||'event',
    render(){},showToast(){},replaceTournamentEntryInUrl(){},routeTournamentEntry(code,entry){calls.routed.push({code,entry});}
  };
  vm.createContext(context);
  vm.runInContext('let qrScannerOpen=true,qrScannerStatus="",qrScannerStream=null,qrScannerVideoElement=null,qrScannerFrame=null,qrScannerBusy=false;let firebaseUser={uid:"u1"},userProfile={active:true},currentRole="player",guestReadOnlyMode=false,appPhase="player-center";'+scanner+'\n'+modal+'\n'+lifecycle,context);
  const run=s=>vm.runInContext(s,context);
  return {run,calls,nodes,frames,timers,handlers,document,window,stream,setNow:v=>now=v,resolveMedia:()=>resolveMedia(stream),
    async open(){run('syncQrScannerModal()');await flush();},async frame(){const [id,fn]=frames.entries().next().value;frames.delete(id);await fn();}};
}
test('camera attaches and plays before any animation frame runs',async()=>{
  const x=setup();await x.open();assert.equal(x.calls.play,1);assert.equal(x.nodes.get('qr-scanner-video').srcObject,x.stream);assert.equal(x.calls.media,1);
});
test('app re-renders retain the connected portal and video without reacquiring camera',async()=>{
  const x=setup();await x.open();const video=x.nodes.get('qr-scanner-video'),portal=x.nodes.get('qr-scanner-portal');
  for(let i=0;i<20;i++)x.run('syncQrScannerModal()');
  assert.equal(x.nodes.get('qr-scanner-video'),video);assert.equal(x.nodes.get('qr-scanner-portal'),portal);assert.equal(x.calls.media,1);assert.equal(x.calls.play,1);
  assert.match(source,/function render\(\)\{\s*syncQrScannerModal\(\);/);
  assert.equal(x.run('renderQrScannerModal()'),'');
});
test('close releases tracks and removes portal; reopening starts a fresh session',async()=>{
  const x=setup();await x.open();x.run('stopQrScanner();qrScannerOpen=false;syncQrScannerModal()');assert.equal(x.calls.stop,1);assert.equal(x.frames.size,0);assert.equal(x.nodes.size,0);
  x.run('qrScannerOpen=true;qrScannerAttempted=false;syncQrScannerModal()');await flush();assert.equal(x.calls.media,2);assert.equal(x.calls.play,2);
});
test('late camera permission after closing releases stream and never plays',async()=>{
  const x=setup({pending:true});await x.open();x.run('stopQrScanner();qrScannerOpen=false;syncQrScannerModal()');x.resolveMedia();await flush();assert.equal(x.calls.stop,1);assert.equal(x.calls.play,0);
});
test('backgrounding releases camera and requires explicit retry',async()=>{
  const x=setup();await x.open();x.document.hidden=true;x.handlers.visibilitychange();assert.equal(x.calls.stop,1);assert.match(x.run('qrScannerStatus'),/已暫停/);
  x.document.hidden=false;x.run('syncQrScannerModal()');await flush();assert.equal(x.calls.media,1);
  x.run('stopQrScanner();qrScannerAttempted=false;startQrScanner()');await flush();assert.equal(x.calls.media,2);
});
test('pagehide releases camera',async()=>{const x=setup();await x.open();x.handlers.pagehide();assert.equal(x.calls.stop,1);assert.equal(x.frames.size,0);});
test('rejected video playback reports recoverable error and releases stream',async()=>{
  const x=setup({playError:true});await x.open();assert.equal(x.calls.stop,1);assert.match(x.run('qrScannerStatus'),/重新啟動/);assert.equal(x.frames.size,0);
});
test('hanging video playback times out instead of leaving a black preview forever',async()=>{
  const x=setup({playPending:true});await x.open();const timeout=[...x.timers.values()].find(t=>t.ms===8000);assert.ok(timeout);timeout.fn();await flush();assert.equal(x.calls.stop,1);assert.match(x.run('qrScannerStatus'),/重新啟動/);
});
test('video that plays without image dimensions times out and stops',async()=>{
  const x=setup();await x.open();x.nodes.get('qr-scanner-video').videoWidth=0;x.setNow(9000);await x.frame();assert.equal(x.calls.stop,1);assert.match(x.run('qrScannerStatus'),/重新啟動/);
});
test('check-in QR retains account and routes exactly once through existing check-in handler',async()=>{
  const x=setup();await x.open();const url='https://arena.test/?checkin=BXH-ABC123&checkinToken=test';x.window.jsQR=()=>({data:url});await x.frame();assert.deepEqual(x.calls.accepted,[url]);assert.equal(x.calls.stop,1);assert.equal(x.run('firebaseUser.uid'),'u1');assert.equal(x.run('qrScannerOpen'),false);
});
test('ordinary tournament QR and invalid QR retain existing routing behavior',async()=>{
  const x=setup();await x.open();assert.equal(await x.run('acceptScannedQrValue("invalid")'),false);assert.equal(x.calls.stop,0);assert.equal(await x.run('acceptScannedQrValue("BXH-ABC123")'),true);assert.deepEqual(x.calls.routed,[{code:'BXH-ABC123',entry:'event'}]);assert.equal(x.calls.stop,1);
});
