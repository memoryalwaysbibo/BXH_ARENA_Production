'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
for(const args of [['--test',path.join(__dirname,'recovery.test.cjs'),path.join(__dirname,'callable.test.cjs')],[path.join(__dirname,'check.cjs')],[path.join(__dirname,'run100.cjs')]]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
