'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {stage,sourceFiles}=require('./release/stage.cjs');
test('standalone release package includes only required V3 code and shared authorization dependencies',t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bxh-v3-stage-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const dest=stage(path.join(tmp,'functions'));
 for(const file of [...sourceFiles,'index.cjs'])execFileSync(process.execPath,['--check',path.join(dest,file)]);
 assert.equal(typeof require(path.join(dest,'registration-flow-v3/api.cjs')).createApi,'function');
 assert.equal(typeof require(path.join(dest,'registration-flow-v3/create-room.cjs')).createRoomHandler,'function');
 assert.throws(()=>stage(dest),/EEXIST/);
 assert.equal(fs.existsSync(path.join(dest,'registration-flow-v3/service.cjs')),false);
 const entry=fs.readFileSync(path.join(dest,'index.cjs'),'utf8');
 assert.match(entry,/enforceAppCheck:true/);
 assert.match(entry,/BXH_REGISTRATION_V3_ENABLED!=='true'/);
});
