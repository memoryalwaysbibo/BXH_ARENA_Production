'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
function exited(p){return new Promise((ok,no)=>{p.once('exit',(code,signal)=>ok({code,signal}));p.once('error',no);});}
test('dummy child in spaced directory starts and stops via stdin; no sockets',{timeout:8000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena dummy ')),file=path.join(dir,'dummy program.cjs');fs.writeFileSync(file,"console.log('READY');process.stdin.on('data',()=>process.exit(0));setInterval(()=>{},1000)");
 const p=spawn(process.execPath,[file],{cwd:dir,stdio:['pipe','pipe','pipe'],shell:false});const done=exited(p);let killed=false;
 try{await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('readiness-timeout')),3000);p.stdout.on('data',d=>{if(String(d).includes('READY')){clearTimeout(timer);ok();}});p.once('error',e=>{clearTimeout(timer);no(e);});});p.stdin.end('stop');assert.deepEqual(await done,{code:0,signal:null});assert.throws(()=>process.kill(p.pid,0));}finally{if(p.exitCode===null){killed=p.kill();await done.catch(()=>{});}fs.rmSync(dir,{recursive:true,force:true});}assert.equal(killed,false);
});
test('missing executable produces bounded ENOENT, not a hanging launcher',{timeout:4000},async()=>{const p=spawn(path.join(os.tmpdir(),'arena-does-not-exist-'+process.pid),[],{shell:false});const e=await new Promise(r=>p.once('error',r));assert.equal(e.code,'ENOENT');});
