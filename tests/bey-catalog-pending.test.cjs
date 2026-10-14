'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../modules/bey-catalog/catalog-pending-model.js');
const root = path.resolve(__dirname,'..');
const bytes = fs.readFileSync(path.join(root,model.DATA_URL));
const data = JSON.parse(bytes);
const buffer = b => b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
test('provisional snapshot is separate, pinned, minimal, stable and complete within provided scope',async()=>{
 assert.deepEqual(await model.decodeSnapshot(buffer(bytes)), await model.validate(data));
});
test('series counts, stable IDs and unresolved row remain distinct',()=>{
 assert.equal(data.entries.length,285);assert.equal(new Set(data.entries.map(r=>r.suppliedId)).size,285);
 for(const [series,count] of Object.entries(model.SERIES_COUNTS)) assert.equal(model.filter(data,'',series).length,count);
 assert.equal(data.unresolved.length,1);assert.equal(model.filter(data,'BXA-').length,7);
 for(const code of ['BXA-03','BXA-04','BXA-05']) {const rows=model.filter(data,code);assert.equal(rows.length,2);assert.notEqual(rows[0].suppliedId,rows[1].suppliedId);assert.notEqual(rows[0].suppliedNameConfiguration,rows[1].suppliedNameConfiguration);}
 assert.deepEqual(model.filter(data).map(r=>r.suppliedId),data.entries.map(r=>r.suppliedId));
});
test('search supports code, supplied names, configuration, fullwidth and whitespace normalization',()=>{
 for(const query of ['BX-01','ＢＸ－０１',' bx - 01 ']) assert.equal(model.filter(data,query)[0].code,'BX-01');
 assert.ok(model.filter(data,'蒼龍').length>0);assert.ok(model.filter(data,'3-60F').length>0);
 assert.equal(model.filter(data,'BX-01','UX').length,0);assert.equal(model.filter(data,'definitelymissing').length,0);
});
test('tamper and unavailable security fail closed',async()=>{
 const bad=Buffer.from(bytes);bad[500]^=1;
 await assert.rejects(model.decodeSnapshot(buffer(bad)),/PENDING_VERSION_MISMATCH/);
 await assert.rejects(model.decodeSnapshot(buffer(bytes),{}),/SECURE_CONTEXT_REQUIRED/);
 await assert.rejects(model.decodeSnapshot(buffer(bytes.subarray(1))),/PENDING_VERSION_MISMATCH/);
});
for(const [name,mutate] of Object.entries({privateField:d=>d.entries[0].reviewerUid='secret',verifiedName:d=>d.entries[0].officialName='claimed',duplicateID:d=>d.entries[1].suppliedId=d.entries[0].suppliedId,wrongCount:d=>d.entries.pop(),reordered:d=>d.entries.reverse(),overclaim:d=>d.taiwanReleaseStatus='released',invalidCode:d=>d.entries[0].code='BX-',missingName:d=>d.entries[0].suppliedNameConfiguration='',wrongUnresolved:d=>d.unresolved[0].code='BXA-99'}))test('reject '+name,()=>{const d=structuredClone(data);mutate(d);assert.throws(()=>model.validate(d),/INVALID_PENDING_INVENTORY/);});
test('UI cannot execute supplied HTML; same-origin pinned anonymous read only',()=>{
 const ui=fs.readFileSync(path.join(root,'modules/bey-catalog/catalog-pending-ui.js'),'utf8');
 assert.doesNotMatch(ui,/innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(|localStorage|firebase|XMLHttpRequest/);
 assert.match(ui,/textContent/);assert.match(ui,/credentials:'omit'/);assert.match(ui,/cache:'no-store'/);assert.match(ui,/redirect:'error'/);
 assert.doesNotMatch(bytes.toString(),/reviewerUid|registry|candidate|product_\d|https?:|原文行號/);
});
test('package includes and verifies pending snapshot independently',async()=>{
 const {inspectRuntime}=require('../scripts/package-bey-catalog-public.cjs');
 const {manifest}=await inspectRuntime();assert.deepEqual(manifest.pendingInventory,{sha256:model.EXPECTED_SHA256,entries:285,unresolved:1});
 assert.equal(manifest.counts.products,9);assert.equal(manifest.counts.parts,47);
});

class Element {
  constructor(tagName = 'div') { this.tagName = tagName.toUpperCase();this.children = [];this.dataset = {};this.attributes = {};this.listeners = {};this._text = '';this.value = '';this.hidden = false;this.disabled = false; }
  set textContent(value) { this._text = String(value);this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Unsafe HTML sink'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = '';this.children = children;if(this.tagName === 'SELECT') this.value = children[0]?.value || ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  async emit(name) { return Promise.all((this.listeners[name] || []).map(callback => callback({target: this}))); }
  focus() { this.focused = true; }
}
const vm = require('node:vm');
function harness(fetcher, view = 'pending', suppliedModel = model) {
 const html=fs.readFileSync(path.join(root,'bey-catalog.html'),'utf8');
 const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element('div')]));
 ids['pending-search'].value='';ids['pending-series'].value='all';
 const buttons=['verified','pending'].map(view=>{const b=new Element('button');b.dataset.catalogView=view;return b;});
 const calls=[],historyCalls=[],listeners={},timers=new Map();let tid=0;
 const window={BXHPendingInventory:suppliedModel,location:{href:'https://catalog.test/bey-catalog.html'+(view==='pending'?'?view=pending':'')},setTimeout:cb=>{timers.set(++tid,cb);return tid;},clearTimeout:id=>timers.delete(id),addEventListener:(name,cb)=>{listeners[name]=cb;}};
 const history={pushState:(_,__,url)=>{window.location.href=String(url);historyCalls.push(String(url));}};
 const document={getElementById:id=>ids[id],createElement:tag=>new Element(tag),querySelectorAll:()=>buttons};
 vm.runInNewContext(fs.readFileSync(path.join(root,'modules/bey-catalog/catalog-pending-ui.js'),'utf8'),{window,document,history,URL,AbortController,fetch:(...args)=>{calls.push(args);return fetcher(...args);}});
 return {ids,buttons,calls,historyCalls,listeners,window,timers};
}
const response=(value=bytes,ok=true)=>({ok,arrayBuffer:async()=>buffer(value)});
async function settled(h,state='ready') {for(let i=0;i<100&&h.ids['pending-panel'].dataset.state!==state;i++)await new Promise(r=>setTimeout(r,5));assert.equal(h.ids['pending-panel'].dataset.state,state);}
test('pending direct link renders 285 independent rows; filters and duplicate variants survive repeated views',async()=>{
 const h=harness(async()=>response());await settled(h);
 assert.equal(h.ids['pending-results'].children.length,285);assert.equal(h.ids['verified-panel'].hidden,true);assert.equal(h.calls.length,1);
 h.ids['pending-search'].value='BXA-03';await h.ids['pending-search'].emit('input');assert.equal(h.ids['pending-results'].children.length,2);
 assert.notEqual(h.ids['pending-results'].children[0].dataset.suppliedId,h.ids['pending-results'].children[1].dataset.suppliedId);
 await h.buttons[0].emit('click');assert.equal(h.ids['pending-panel'].hidden,true);await h.buttons[1].emit('click');assert.equal(h.ids['pending-results'].children.length,2);assert.equal(h.calls.length,1);
 await h.ids['pending-reset'].emit('click');assert.equal(h.ids['pending-results'].children.length,285);assert.equal(h.ids['pending-search'].focused,true);
 h.ids['pending-series'].value='UX';await h.ids['pending-series'].emit('change');assert.equal(h.ids['pending-results'].children.length,44);
 h.ids['pending-search'].value='notfound';await h.ids['pending-search'].emit('input');assert.match(h.ids['pending-results'].textContent,/沒有符合/);
 assert.equal(h.timers.size,0);
});
test('verified entry lazily loads pending only on selection; Back/Forward restores scope',async()=>{
 const h=harness(async()=>response(),'verified');assert.equal(h.calls.length,0);assert.equal(h.ids['pending-panel'].hidden,true);
 await h.buttons[1].emit('click');await settled(h);assert.match(h.window.location.href,/view=pending/);
 await h.buttons[1].emit('click');assert.equal(h.historyCalls.length,1);assert.equal(h.calls.length,1);
 h.window.location.href='https://catalog.test/bey-catalog.html';h.listeners.popstate();assert.equal(h.ids['pending-panel'].hidden,true);
 h.window.location.href+='?view=pending';h.listeners.popstate();assert.equal(h.ids['pending-panel'].hidden,false);assert.equal(h.calls.length,1);
});
test('network failure and stale bytes clear data; repeated retry cannot overlap requests',async()=>{
 let broken=true,resolve;const h=harness(async()=>{if(broken)return response(Buffer.from('{}'));return new Promise(r=>{resolve=r;});});await settled(h,'error');
 assert.equal(h.ids['pending-results'].children.length,0);assert.equal(h.ids['pending-controls'].disabled,true);
 broken=false;const first=h.ids['pending-retry'].emit('click');await h.ids['pending-retry'].emit('click');assert.equal(h.calls.length,2);
 resolve(response());await first;await settled(h);assert.equal(h.ids['pending-results'].children.length,285);assert.equal(h.ids['pending-retry'].hidden,true);
});
test('synthetic hostile name is text only and no image or external links are invented',async()=>{
 const hostile=structuredClone(data);hostile.entries[0].suppliedNameConfiguration='<img src=x onerror=alert(1)>';
 const h=harness(async()=>response(),'pending',{...model,decodeSnapshot:async()=>hostile});await settled(h);
 const card=h.ids['pending-results'].children[0];assert.ok(card.textContent.includes('<img src=x onerror=alert(1)>'));
 function descend(e){return[e,...e.children.flatMap(descend)];}
 assert.equal(descend(card).filter(e=>['IMG','A','SCRIPT'].includes(e.tagName)).length,0);
});
