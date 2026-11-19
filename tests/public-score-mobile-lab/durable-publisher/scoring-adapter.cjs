'use strict';
// Compile a separate lab-only copy; never modifies the production module on disk.
const fs=require('node:fs'),Module=require('node:module');
function createScoringWithOutbox(db,publisher,opts){
 const filename=require.resolve('../../../referee-seats/functions/scoring-service.cjs');
 const anchor="  diagnostic.phase('queue-writes');";
 const source=fs.readFileSync(filename,'utf8');
 if(require('node:crypto').createHash('sha256').update(source).digest('hex')!=='d213e3b4d6f6eb12c3b2a05cd6365f02ce667a3176ced28a0d07602726af60bd')throw Error('scoring-source-hash-drift');
 if(source.split(anchor).length!==2)throw Error('scoring-source-drift');
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(require('node:path').dirname(filename));
 m._compile(source.replace(anchor,anchor+'\n  __labPublisher.enqueue(tx,room,state,code);').replace("'use strict';","'use strict';\nlet __labPublisher;\nmodule.exports.__setPublisher=p=>{__labPublisher=p;};").replace('module.exports={createScoringHandler};','module.exports.createScoringHandler=createScoringHandler;'),filename);
 m.exports.__setPublisher(publisher);return m.exports.createScoringHandler(db,opts);
}
module.exports={createScoringWithOutbox};
