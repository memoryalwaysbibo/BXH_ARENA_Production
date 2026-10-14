'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const model=require('../modules/bey-catalog/catalog-candidate-model.js');
const inventory=require('../modules/bey-catalog/catalog-pending-model.js');
const h='a'.repeat(64), s='b'.repeat(64), page='https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx01.html',img='https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/BX01.png';
const row={recordId:'supplied_20261014_0001',imageURL:'assets/bey-catalog/candidates/'+h+'.webp',sourceURL:page,sourceImageURL:img,imageSha256:h,sourceImageSha256:s,pairingConfidence:'exact_variant',status:'candidate'};
const policy={inventorySha256:inventory.EXPECTED_SHA256,recordIds:[row.recordId],sourceURLs:[page,img]};
const fixture=()=>({schemaVersion:1,inventorySha256:policy.inventorySha256,entries:[{...row}]});
test('valid candidates are immutable, all undecided, and missing matches are omitted',()=>{const d=model.validate(fixture(),policy);assert.equal(d.entries[0].status,'candidate');assert.ok(Object.isFrozen(d.entries[0]));assert.equal(model.validate({...fixture(),entries:[]},policy).entries.length,0);});
for(const [name,mutate] of Object.entries({duplicate:d=>d.entries.push({...row}),unknownID:d=>d.entries[0].recordId='supplied_20261014_0286',extra:d=>d.entries[0].ownerUid='forged',confirmed:d=>d.entries[0].status='confirmed',error:d=>d.entries[0].status='error',confidence:d=>d.entries[0].pairingConfidence='probably',path:d=>d.entries[0].imageURL='../bad.webp',external:d=>d.entries[0].imageURL='https://evil.test/x.webp',hash:d=>d.entries[0].imageSha256='a',hashArray:d=>d.entries[0].sourceImageSha256=[s],source:d=>d.entries[0].sourceURL='https://evil.test/',query:d=>d.entries[0].sourceURL=page+'?token=secret',inventory:d=>d.inventorySha256=h,prototype:d=>d.entries[0]=Object.assign(Object.create({evil:true}),row)}))test('reject '+name,()=>{const d=fixture();mutate(d);assert.throws(()=>model.validate(d,policy),/INVALID_CANDIDATE_MANIFEST/);});
test('canonical candidate version binds record, image, source and pairing claim',async()=>{const original=await model.candidateVersion(row);assert.equal(original,await model.candidateVersion(Object.fromEntries(Object.entries(row).reverse())));for(const key of Object.keys(row))assert.notEqual(original,await model.candidateVersion({...row,[key]:row[key]+'x'}));});
test('pinned bytes verified before decode; tamper and missing crypto fail closed',async()=>{const b=Buffer.from(JSON.stringify(fixture())),buf=b.buffer.slice(b.byteOffset,b.byteOffset+b.length);const p={...policy,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};assert.equal((await model.decodeSnapshot(buf,p)).entries.length,1);await assert.rejects(model.decodeSnapshot(buf,{...p,sha256:h}),/VERSION_MISMATCH/);await assert.rejects(model.decodeSnapshot(buf,p,{}),/SECURE_CONTEXT_REQUIRED/);});
test('read-only figure uses safe DOM and fallback; no image becomes pending',()=>{const {createFigure}=require('../modules/bey-catalog/catalog-candidate-presentation.js');const doc={createElement:tag=>({tag,children:[],listeners:{},append(...c){this.children.push(...c);},addEventListener(n,f){this.listeners[n]=f;}})};assert.equal(createFigure(doc,null).textContent,'圖片待補');for(const pairingConfidence of ['exact_variant','product_reference']){const f=createFigure(doc,{...row,pairingConfidence});assert.equal(f.children.length,3);if(pairingConfidence==='product_reference')assert.equal(f.children[1].textContent,'同商品參考圖，尚未確認本款配置');assert.equal(f.children[2].rel,'noopener noreferrer');f.children[0].listeners.error();assert.equal(f.children[0].hidden,true);assert.match(f.children[1].textContent,/載入失敗/);}});

test('revival product figures preserve their additional original-series rights notices',()=>{
 const {createFigure}=require('../modules/bey-catalog/catalog-candidate-presentation.js');const doc={createElement:tag=>({tag,children:[],append(...c){this.children.push(...c);},addEventListener(){}})};
 for(const [page,notice] of [['bx00-drs.html','©青木たかお・ベイブレードプロジェクト'],['bx00-ld.html','©Takafumi Adachi, MFBBProject, TV Tokyo'],['bx00-rl.html','©Takafumi Adachi, MFBBProject, TV Tokyo'],['bx00-sp.html','©Takafumi Adachi, MFBBProject, TV Tokyo'],['bx00-ss.html','ⒸHiro Morita, BBBProject, TV TOKYO'],['bx00-xc.html','ⒸHiro Morita, BBBProject, TV TOKYO']]){
  const figure=createFigure(doc,{...row,sourceURL:'https://beyblade.takaratomy.co.jp/beyblade-x/lineup/'+page});assert.equal(figure.children[3].textContent,notice);
 }
});
function handoffFixture(clipboard, extra={}){
 const {createManualImageHandoff}=require('../modules/bey-catalog/catalog-candidate-presentation.js');
 const document={createElement:tag=>({tag,children:[],attributes:{},listeners:{},append(...c){this.children.push(...c);},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.listeners[k]=v;},focus(){this.focused=true;},select(){this.selected=true;}})};
 const supplied={suppliedId:'supplied_20261014_0280',code:'BXA-03',suppliedNameConfiguration:'原始名稱 <img src=x onerror=alert(1)>',...extra};
 return createManualImageHandoff(document,supplied,row,clipboard);
}
test('manual handoff binds exact supplied ID and safe original text without upload controls',()=>{
 const details=handoffFixture();const [summary,explanation,rights,label,input,button,status]=details.children;
 assert.equal(summary.tag,'summary');assert.match(summary.attributes['aria-label'],/supplied_20261014_0280/);
 assert.match(explanation.textContent,/不會上傳或儲存/);assert.match(rights.textContent,/已獲授權/);
 assert.equal(label.htmlFor,input.id);assert.equal(input.readOnly,true);assert.match(input.value,/原始名稱 <img src=x onerror=alert\(1\)>/);assert.match(input.value,new RegExp(h));
 assert.equal(status.attributes.role,'status');assert.equal(button.type,'button');assert.ok(details.children.every(e=>!['form','img','input','script'].includes(e.tag)));
 const other=handoffFixture(undefined,{suppliedId:'supplied_20261014_0281'});assert.notEqual(input.id,other.children[4].id);assert.notEqual(input.value,other.children[4].value);
});
test('manual copy success copies exact template and suppresses repeated clicks while pending',async()=>{
 let resolve,count=0,copied;const d=handoffFixture({writeText:t=>{count++;copied=t;return new Promise(r=>{resolve=r;});}}),b=d.children[5];
 const pending=b.listeners.click();await b.listeners.click();assert.equal(count,1);assert.equal(b.disabled,true);resolve();await pending;
 assert.equal(copied,d.children[4].value);assert.match(d.children[6].textContent,/已複製/);assert.equal(b.disabled,false);
});
for(const mode of ['missing','denied','selection-failure'])test('manual copy fallback '+mode,async()=>{
 const d=handoffFixture(mode==='missing'?null:{writeText:async()=>{throw Error('Denied');}}),input=d.children[4];
 if(mode==='selection-failure')input.select=()=>{throw Error('Unsupported');};
 await d.children[5].listeners.click();assert.doesNotMatch(d.children[6].textContent,/已複製/);assert.match(d.children[6].textContent,/無法自動複製/);
 if(mode!=='selection-failure')assert.equal(input.selected,true);assert.equal(d.children[5].disabled,false);
});
test('manual handoff module has no file chooser, upload, remote write, auth or storage code',()=>{
 const text=require('node:fs').readFileSync(require('node:path').join(__dirname,'../modules/bey-catalog/catalog-candidate-presentation.js'),'utf8');
 assert.doesNotMatch(text,/fetch\s*\(|XMLHttpRequest|firebase|localStorage|sessionStorage|FormData|type\s*=\s*['"]file|innerHTML|insertAdjacentHTML/);
});
