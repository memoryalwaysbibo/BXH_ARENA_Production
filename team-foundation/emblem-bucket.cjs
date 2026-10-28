'use strict';
// Standard Firebase buckets only; reject cross-project targets and missing config.
function resolveEmblemBucket({projectId,bucket}){
 if(typeof projectId!=='string'||!projectId||typeof bucket!=='string'||![projectId+'.firebasestorage.app',projectId+'.appspot.com'].includes(bucket))throw Error('team-emblem-bucket-unconfigured');
 return bucket;
}
module.exports={resolveEmblemBucket};
