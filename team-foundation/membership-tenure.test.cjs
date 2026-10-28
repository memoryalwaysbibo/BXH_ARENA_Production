'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {resolveTenure}=require('./membership-tenure.cjs');
const t=(teamId,tenureId,joinedAt,leftAt)=>({uid:'p',teamId,tenureId,joinedAt,leftAt});
test('resolves the team at archive time even after joining another team',()=>{
 const tenures=[t('old','one',100,300),t('new','two',400,null)];
 assert.deepEqual(resolveTenure({uid:'p',archivedAt:200,tenures}),{teamId:'old',tenureId:'one',joinedAt:100});
 assert.equal(resolveTenure({uid:'p',archivedAt:350,tenures}),null);
 assert.equal(resolveTenure({uid:'p',archivedAt:400,tenures}).teamId,'new');
});
test('departure is exclusive and a rejoin does not inherit the previous stint',()=>{
 const tenures=[t('same','first',100,300),t('same','second',300,null)];
 assert.equal(resolveTenure({uid:'p',archivedAt:299,tenures}).tenureId,'first');
 assert.equal(resolveTenure({uid:'p',archivedAt:300,tenures}).tenureId,'second');
});
test('overlapping histories and invalid or mismatched entries cannot assign credit',()=>{
 assert.throws(()=>resolveTenure({uid:'p',archivedAt:250,tenures:[t('a','one',100,300),t('b','two',200,null)]}),/ambiguous/);
 for(const entry of [{...t('a','one',100,null),uid:'other'},t('a','one',300,100),t('a','one',-1,null)])assert.throws(()=>resolveTenure({uid:'p',archivedAt:200,tenures:[entry]}),/invalid-tenure/);
});
