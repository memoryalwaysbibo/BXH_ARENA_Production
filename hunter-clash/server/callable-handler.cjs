'use strict';
// Transport adapter only. The service independently verifies bearer tokens and DB roles.
const OPERATIONS=Object.freeze(['submit','beginVerification','verifyResult','reviewRisk','settle']);
const ERRORS=Object.freeze({
  'invalid-request':'invalid-argument','invalid-id':'invalid-argument','invalid-revision':'invalid-argument',
  'invalid-score':'invalid-argument','winner-mismatch':'invalid-argument',
  'invalid-decision':'invalid-argument','invalid-risk-review':'failed-precondition',
  'unauthenticated':'unauthenticated','account-unavailable':'permission-denied',
  'challenge-unavailable':'permission-denied','review-forbidden':'permission-denied',
  'risk-review-forbidden':'permission-denied','settlement-forbidden':'permission-denied',
  'result-unavailable':'permission-denied','closed':'failed-precondition',
  'revision-conflict':'aborted','request-id-reused':'already-exists',
  'result-already-exists':'already-exists','settled-result-conflict':'failed-precondition',
  'verification-not-ready':'failed-precondition','invalid-transition':'failed-precondition',
  'result-not-cleared':'failed-precondition','invalid-verification':'failed-precondition',
  'witness-unavailable':'failed-precondition','risk-reviewer-unavailable':'failed-precondition',
  'invalid-sandbox-stats':'failed-precondition'
});
function createCallableHandler(service,HttpsError){
  return async request=>{
    const authorization=request.rawRequest?.headers?.authorization;
    if(!request.auth || typeof authorization!=='string' || !/^Bearer \S+$/.test(authorization))
      throw new HttpsError('unauthenticated','Sign in before using HUNTER CLASH.');
    const envelope=request.data;
    if(!envelope || typeof envelope!=='object' || Array.isArray(envelope) ||
        Object.keys(envelope).some(key=>!['operation','input'].includes(key)) ||
        !OPERATIONS.includes(envelope.operation))
      throw new HttpsError('invalid-argument','Invalid command envelope.');
    try{
      return await service[envelope.operation](authorization.slice(7),envelope.input);
    }catch(error){
      if(typeof error.code==='string' && error.code.startsWith('auth/'))
        throw new HttpsError('unauthenticated','Sign in again before retrying.');
      const code=ERRORS[error.message];
      if(code) throw new HttpsError(code,'Command rejected.',{reason:error.message});
      // Unknown SDK/database failures must not leak stack traces, paths, credentials or user data.
      throw new HttpsError('internal','Command could not be completed.');
    }
  };
}
module.exports={createCallableHandler};
