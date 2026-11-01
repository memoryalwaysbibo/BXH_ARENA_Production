'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createData01bEmulatorLoader}=require('../../modules/bey-catalog/catalog-data01b-private-emulator-loader.cjs');
const target={mode:'emulator',projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189'};
const db={projectId:target.projectId,collection(){throw Error('NETWORK_MUST_NOT_RUN');},runTransaction(){throw Error('NETWORK_MUST_NOT_RUN');}};
test('production targets and foreign database reject before file or database access',()=>{
 const old=process.env.FIRESTORE_EMULATOR_HOST;process.env.FIRESTORE_EMULATOR_HOST=target.emulatorHost;
 try{
  for(const change of [{mode:'production'},{projectId:'real-project'},{emulatorHost:'remote.example:8189'}])
   assert.throws(()=>createData01bEmulatorLoader({db,target:{...target,...change},fixtureFile:'/not-read'}),/LOCAL_EMULATOR_REQUIRED/);
  assert.throws(()=>createData01bEmulatorLoader({db:{...db,projectId:'real-project'},target,fixtureFile:'/not-read'}),/LOCAL_EMULATOR_REQUIRED/);
 }finally{if(old===undefined)delete process.env.FIRESTORE_EMULATOR_HOST;else process.env.FIRESTORE_EMULATOR_HOST=old;}
});
test('private source missing or substituted fails closed without exposing its path',()=>{
 const old=process.env.FIRESTORE_EMULATOR_HOST;process.env.FIRESTORE_EMULATOR_HOST=target.emulatorHost;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-source-'));
 try{
  assert.throws(()=>createData01bEmulatorLoader({db,target}),/PRIVATE_FILE_REQUIRED/);
  assert.throws(()=>createData01bEmulatorLoader({db,target,fixtureFile:path.join(dir,'missing')}),e=>e.message==='DATA01B_LOADER_PRIVATE_FILE_UNAVAILABLE');
  const file=path.join(dir,'replacement.json');fs.writeFileSync(file,'{}');
  assert.throws(()=>createData01bEmulatorLoader({db,target,fixtureFile:file}),e=>e.message==='DATA01B_LOADER_SOURCE_SHA_MISMATCH');
 }finally{fs.rmSync(dir,{recursive:true,force:true});if(old===undefined)delete process.env.FIRESTORE_EMULATOR_HOST;else process.env.FIRESTORE_EMULATOR_HOST=old;}
});
