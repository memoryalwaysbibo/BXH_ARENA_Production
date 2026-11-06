'use strict';
/** TW-07 read-only mobile review model; UI visibility is NOT authorization. */
const PRIORITY={P0:0,P1:1,P2:2};
const VALID_FILTERS=['all','P0','P1','P2'];
function createReviewMobileModel(queue,{filter='all',query='',viewerRole='guest'}={}){
 if(!queue||!Array.isArray(queue.items)||queue.productionWritable!==false||queue.autoPublish!==false)throw Error('TW07_RESEARCH_QUEUE_REQUIRED');
 if(!VALID_FILTERS.includes(filter))throw Error('TW07_FILTER_INVALID');
 const allowed=['admin','super_admin'].includes(viewerRole);
 if(!allowed)return {access:'denied',readOnly:true,canApprove:false,canPublish:false,visibleItems:[],summary:null};
 const q=String(query).trim().toLocaleLowerCase('zh-TW');
 const visible=queue.items.filter(x=>(filter==='all'||x.priority===filter)&&
  (!q||[x.recordId,x.reasonCode,x.details,x.section].some(v=>String(v||'').toLocaleLowerCase('zh-TW').includes(q))))
  .map(x=>({queueId:x.queueId,recordId:x.recordId,section:x.section,priority:x.priority,
   reasonCode:x.reasonCode,details:x.details,reviewState:x.reviewState,
   canApprove:false,canPublish:false,readOnly:true}));
 visible.sort((a,b)=>PRIORITY[a.priority]-PRIORITY[b.priority]||a.recordId.localeCompare(b.recordId));
 return {access:'preview',readOnly:true,canApprove:false,canPublish:false,visibleItems:visible,
  summary:{...queue.summary,visible:visible.length},filter,query:String(query)};
}
module.exports={createReviewMobileModel,VALID_FILTERS};
