'use strict';
/** DB-01: pure target and dataset gate; no Firebase SDK or network calls. */
const PROD = new Set(['bxh-arena']);
const allowedCollections = Object.freeze(['beyProducts','beyProductOptions','beyPackageContents','beyParts','beyPartVariants','beyColors','beySources','beyAssemblyClaims','beyCatalogIssues','beyCatalogAudit']);
function assertIsolatedTarget({projectId, emulatorHost, mode} = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw Error('PROJECT_ID_REQUIRED');
  if (PROD.has(projectId) || /(^|[-_])prod(uction)?($|[-_])/i.test(projectId)) throw Error('PRODUCTION_TARGET_FORBIDDEN');
  if (mode !== 'emulator') throw Error('EMULATOR_ONLY_DB01');
  if (!/^demo-[a-z0-9-]+$/.test(projectId)) throw Error('DEMO_PROJECT_REQUIRED');
  if (typeof emulatorHost !== 'string' || !/^(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(emulatorHost)) throw Error('LOCAL_EMULATOR_REQUIRED');
  return Object.freeze({mode:'emulator',projectId,emulatorHost,readOnlyProduction:true});
}
function inspectResearchBatch(batch) {
  if (!batch || batch.dataOrigin !== 'source-tiered-research' || batch.productionWritable !== false || batch.autoPublish !== false) throw Error('RESEARCH_BATCH_NOT_SAFE');
  if (!Array.isArray(batch.sources) || batch.sources.some(s=>!s.sourceId || !s.url || s.automatedAccess !== 'not_enabled')) throw Error('SOURCE_SCOPE_UNREVIEWED');
  const sections = ['products','parts','variants','options','issues'];
  const counts = Object.fromEntries(sections.map(k=>[k,Array.isArray(batch[k])?batch[k].length:0]));
  return Object.freeze({batchId:batch.batchId,mode:'DRY_RUN_ONLY',counts,allowedCollections,blockedActions:['write-production','auto-publish','download-images','modify-player-data']});
}
module.exports={assertIsolatedTarget,inspectResearchBatch,allowedCollections};
