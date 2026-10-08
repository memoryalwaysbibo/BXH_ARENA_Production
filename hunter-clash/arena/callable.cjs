'use strict';
function createHandler(service,HttpsError){return async request=>{
 if(!request.auth||!request.app)throw new HttpsError('unauthenticated','unauthenticated');
 const data=request.data;if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['operation','input'].includes(k)))throw new HttpsError('invalid-argument','invalid-input');
 const header=request.rawRequest?.headers?.authorization;if(typeof header!=='string'||!/^Bearer \S+$/.test(header))throw new HttpsError('unauthenticated','unauthenticated');
 try{return await service.run(header.slice(7),data.operation,data.input);}
 catch(e){const reason=e.message;const codes={'unauthenticated':'unauthenticated','account-unavailable':'permission-denied','admin-required':'permission-denied','participant-required':'permission-denied','closed':'failed-precondition','pairing-rate-limited':'resource-exhausted','revision-conflict':'aborted','history-changed':'aborted'};const known=codes[reason]||(/^(invalid-|pairing-|challenge-|finish-|round-|review-|undo-|terminal-|request-id-|opponent-|ledger-|history-|environment-)/.test(reason)?'failed-precondition':null);throw new HttpsError(known||'internal',known?reason:'service-unavailable');}
};}
module.exports={createHandler};
