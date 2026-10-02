'use strict';
// Run against a staged tree: BXH_PILOT_ROOT=/tmp/v2 node --test this-file.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.resolve(process.env.BXH_PILOT_ROOT||path.join(__dirname,'..'));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const moves={
 'management-ui-v2.js':'modules/management-v2/navigation.js',
 'management-ui-v2-adapter.js':'modules/management-v2/adapter.js',
 'management-ui-v2-bootstrap.js':'modules/management-v2/bootstrap.js',
 'management-ui-v2.css':'modules/management-v2/styles.css'
};
const manifest=JSON.parse(read('management-v2-migration-manifest.json'));
const index=read('index.html');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const [old,next] of Object.entries(moves)){
 test('byte-identical module: '+next,()=>{
  assert.equal(read(next),read(old));
  assert.equal(sha(read(next)),manifest.modules.find(x=>x.to===next).sha256);
 });
}
test('only four entrypoint paths change; all original inline logic is retained',()=>{
 let restored=index;
 for(const [old,next] of Object.entries(moves)){
  assert.equal(index.split(next).length-1,1);
  restored=restored.replace(next,old);
 }
 const bytes=Buffer.from(restored);
 const blob=crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 assert.equal(blob,'ff61e00a1ed2ca15eff7af9a8de83aeff9141b92');
});
test('classic-script ordering is unchanged; shared modules are not moved',()=>{
 const sequence=['modules/management-v2/navigation.js','modules/management-v2/adapter.js',
  'interface-preference.js','my-interface-ui.js','player-identity-ui.js','modules/management-v2/bootstrap.js'];
 let last=-1;
 for(const item of sequence){const offset=index.indexOf('<script src="'+item);assert.ok(offset>last);last=offset;}
 assert.ok(!/<script[^>]*type="module"[^>]*src="modules\/management-v2/.test(index));
});
function load(file){const context={window:{}};vm.runInNewContext(read(file),context);return context.window.BXH_MANAGEMENT_UI_V2;}
const legacy=load('management-ui-v2.js'),candidate=load(moves['management-ui-v2.js']);
const plain=x=>JSON.parse(JSON.stringify(x));
const admin=['management','registrations','settings','people','live','bracket','referee','duty','ladder','member-raffles','inventory-admin','operations','history','version'];
const staff=['live','bracket','duty','ladder','operations','history','version'];
test('public model API remains unchanged',()=>assert.deepEqual(Object.keys(candidate),Object.keys(legacy)));
test('all 16,384 allowed-tab subsets render identically to the baseline',()=>{
 for(let mask=0;mask<1<<admin.length;mask++){
  const tabs=admin.filter((_,i)=>mask&(1<<i));
  assert.deepEqual(plain(candidate.visibleGroups(tabs)),plain(legacy.visibleGroups(tabs)));
  assert.equal(candidate.renderRails(tabs[0]||'',tabs),legacy.renderRails(tabs[0]||'',tabs));
 }
});
test('five usable groups and the existing disabled Hunter placeholder remain',()=>{
 const groups=candidate.visibleGroups(admin);
 assert.equal(groups.filter(x=>!x.placeholder).length,5);
 const hunter=groups.find(x=>x.id==='hunter');assert.ok(hunter.placeholder);assert.equal(hunter.tabs.length,0);
 assert.ok(candidate.renderRails('live',admin).includes('aria-disabled="true"'));
});
test('staff UI manifest does not expose event or activity groups',()=>{
 const groups=candidate.visibleGroups(staff).map(x=>x.id);
 assert.ok(!groups.includes('event'));assert.ok(!groups.includes('activity'));
});
test('existing tab keys and group defaults remain unchanged',()=>{
 for(const key of admin) assert.deepEqual(plain(candidate.resolveActiveGroup(key,admin)),plain(legacy.resolveActiveGroup(key,admin)));
 assert.equal(candidate.firstVisibleTab('field',admin),'live');
 assert.equal(candidate.firstVisibleTab('system',admin),'operations');
});
function clickGroup(activeTab,groupId){
 const host={},calls=[];
 candidate.mount({host,activeTab,visibleTabs:admin,onGroup:(...args)=>calls.push(args)});
 host.onclick({target:{closest:selector=>selector.includes('group')?{dataset:{managementV2Group:groupId}}:null}});
 return calls;
}
test('Hunter placeholder cannot dispatch a navigation action',()=>assert.deepEqual(clickGroup('live','hunter'),[]));
test('re-clicking active ranking group is a no-op',()=>assert.deepEqual(clickGroup('ladder','ranking'),[]));
test('changing group still delegates to the canonical tab key',()=>assert.deepEqual(clickGroup('live','system'),[['operations','system']]));
