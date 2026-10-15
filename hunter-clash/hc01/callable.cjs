'use strict';
const {OPERATIONS}=require('./domain.cjs');
const allowed=new Set(['createChallenge','getChallenge','getMyHistory','acceptCode',...OPERATIONS]);
const codes={
  'invalid-operation':'invalid-argument','invalid-id':'invalid-argument','invalid-input':'invalid-argument',
  'invalid-rules':'failed-precondition','invalid-pairing-policy':'failed-precondition','invalid-time':'failed-precondition',
  'unauthenticated':'unauthenticated','account-unavailable':'permission-denied','opponent-unavailable':'permission-denied',
  'challenge-unavailable':'permission-denied','participant-required':'permission-denied',
  'history-unavailable':'failed-precondition','closed':'failed-precondition','request-id-reused':'already-exists','challenge-already-exists':'already-exists',
  'pairing-rate-limited':'resource-exhausted','pairing-unavailable':'failed-precondition','revision-conflict':'aborted','terminal-state':'failed-precondition',
  'invalid-state':'failed-precondition','invalid-round':'invalid-argument','round-confirmation-invalid':'failed-precondition',
  'undo-unavailable':'failed-precondition','review-unavailable':'failed-precondition',
  'finish-confirmation-invalid':'failed-precondition','environment-mismatch':'failed-precondition','revision-overflow':'failed-precondition'
};
// The runtime decodes request.auth; the service independently verifies the same bearer token.
function createCallableHandler(service,HttpsError){
  return async request=>{
    const header=request.rawRequest?.headers?.authorization;
    if(!request.auth?.uid||typeof header!=='string'||!/^Bearer \S+$/.test(header))
      throw new HttpsError('unauthenticated','Sign in before using Hunter Clash.');
    const data=request.data;
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['operation','input'].includes(k))||!allowed.has(data.operation))
      throw new HttpsError('invalid-argument','Invalid command envelope.');
    try{return await service.run(header.slice(7),data.operation,data.input);}
    catch(error){
      if(typeof error.code==='string'&&error.code.startsWith('auth/'))throw new HttpsError('unauthenticated','Sign in again before retrying.');
      if(codes[error.message])throw new HttpsError(codes[error.message],'Command rejected.',{reason:error.message});
      throw new HttpsError('internal','Command could not be completed.');
    }
  };
}
module.exports={createCallableHandler};
