'use strict';

const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const closedEntrySha='ac9f623f9357e6d208f569d1c1d0f2a4a308401aa8cdfc7ebfce85e8b1957fd8';

function preparePilotEntrypoint(source,room){
 if(typeof room!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(room))throw Error('invalid-pilot-room');
 if(createHash('sha256').update(source).digest('hex')!==closedEntrySha)throw Error('closed-entrypoint-sha-mismatch');
 return source.toString()
  .replace('{createBindings}','{createPilotBindings}')
  .replace('module.exports=createBindings({','module.exports=createPilotBindings({')
  .replace('stagedOnly:true','pilotRoom:'+JSON.stringify(room));
}

if(require.main===module){
 const [source,room]=process.argv.slice(2);
 if(process.argv.length!==4)throw Error('Usage: node prepare-pilot-entrypoint.cjs <reviewed-closed-entry> <room-code>');
 process.stdout.write(preparePilotEntrypoint(readFileSync(source),room));
}
module.exports={preparePilotEntrypoint};
