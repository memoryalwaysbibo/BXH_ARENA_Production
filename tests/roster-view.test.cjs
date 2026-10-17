'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {project,surname,compareNames}=require('../modules/main-app/roster-view.js');
test('stroke sorting follows Traditional Chinese surname order',()=>{
 const rows=['謝承恩','陳小宇','王小明','吳健凱','李維','張吉榮','林小明'].map((name,i)=>({id:'p'+i,name}));
 assert.deepEqual(project(rows,{sort:'stroke'}).map(e=>e.name),['王小明','吳健凱','李維','林小明','張吉榮','陳小宇','謝承恩']);
});
test('compound surnames stay together and given names break ties',()=>{
 assert.equal(surname('歐陽小明'),'歐陽');assert.equal(surname('司馬小明'),'司馬');assert.equal(surname('陳小宇'),'陳');
 const rows=[{name:'歐陽文'},{name:'歐文'},{name:'歐陽一'}];
 assert.deepEqual(project(rows,{sort:'stroke'}).map(e=>e.name),['歐文','歐陽一','歐陽文']);
});
test('partial names, surname, whitespace and width-insensitive Latin searches',()=>{
 const rows=[{name:'吳 健凱'},{name:'吳宸緯'},{name:'Ａｌｉｃｅ ２'},{name:'陳小宇'}];
 assert.equal(project(rows,{query:'吳'}).length,2);assert.equal(project(rows,{query:'健凱'})[0].row,rows[0]);
 assert.equal(project(rows,{query:'alice 2'})[0].row,rows[2]);assert.equal(project(rows,{query:'不存在'}).length,0);
});
test('original order and row identities remain intact after sorting and filtering',()=>{
 const rows=Object.freeze([Object.freeze({id:'w1',name:'謝一',waitRank:1,checkedIn:true}),Object.freeze({id:'w2',name:'王一',waitRank:2,checkedIn:false})]);
 const sorted=project(rows,{sort:'stroke'});assert.equal(sorted[0].row,rows[1]);assert.equal(sorted[0].index,1);assert.equal(sorted[0].row.waitRank,2);
 assert.deepEqual(project(rows).map(e=>e.row),[rows[0],rows[1]]);assert.equal(rows[0].checkedIn,true);
});
test('duplicate names keep original order and non-Han names sort after Chinese',()=>{
 const rows=[{id:1,name:'Amy'},{id:2,name:'陳一'},{id:3,name:'陳一'},{id:4,name:'王一'}];
 assert.deepEqual(project(rows,{sort:'stroke'}).map(e=>e.row.id),[4,2,3,1]);assert.equal(compareNames('陳一','陳一'),0);
});
test('empty or malformed display names can be searched safely',()=>{assert.equal(project([{name:null},{name:undefined}],{query:'王'}).length,0);});
