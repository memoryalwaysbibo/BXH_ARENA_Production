'use strict';
// Called only by the existing scheduled maintenance function.
function createTeamMaintenance({enabled,reconciler,dissolution,emblems}){
 if(typeof enabled!=='function'||!reconciler||!dissolution)throw Error('maintenance-dependencies-required');
 return async()=>{
  if(!enabled())return {status:'disabled'};
  // Run each job even if the other fails; throw so the scheduler can report failure.
  const jobs=await Promise.allSettled([
   (async()=>{await reconciler.enqueue();return reconciler.runBatch();})(),
   dissolution.run(),
   ...(emblems?[emblems.run()]:[])
  ]);
  if(jobs.some(job=>job.status==='rejected'))throw Error('team-maintenance-failed');
  const result=jobs[1].value;
  if(result?.status==='lease-expired'||(Number.isSafeInteger(result?.failed)&&result.failed>0))throw Error('team-dissolution-needs-attention');
  const images=jobs[2]?.value;if(images?.status==='lease-expired'||images?.failed>0)throw Error('team-emblem-cleanup-needs-attention');
  return {status:'completed',projection:jobs[0].value,dissolution:jobs[1].value,...(emblems?{emblems:images}:{})};
 };
}
module.exports={createTeamMaintenance};
