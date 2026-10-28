'use strict';
const {createCommandHandler}=require('./callable.cjs');
function createTeamCallable({db,auth,onCall,HttpsError,enabled=false,readEligibility,readDisplayName}){
 const handler=createCommandHandler({db,auth,HttpsError,enabled,readEligibility,readDisplayName});
 return onCall({region:'asia-east1',enforceAppCheck:true,timeoutSeconds:30,maxInstances:5},handler);
}
module.exports={createTeamCallable};
