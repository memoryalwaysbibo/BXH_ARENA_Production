'use strict';
// Run the captured production award implementation, not a rewritten test copy.
function fromCapturedSource(source,db,FieldValue){
  const helpers=['isTestProfile','safeId','validDocumentId','timestampMillis','activeWindow'].map(name=>{
    const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
    if(start<0||end<start)throw Error('native-helper-source-changed:'+name);
    return source.slice(start,end+2);
  });
  const start=source.indexOf('async function awardTitle('),end=source.indexOf('\nasync function evaluateTitles(',start);
  if(start<0||end<=start)throw Error('native-award-source-boundary-changed');
  return new Function('db','FieldValue','process',helpers.join('\n')+'\n'+source.slice(start,end)+'\nreturn awardTitle;')(db,FieldValue,{env:{GCLOUD_PROJECT:'demo-online-time-titles'}});
}
module.exports={fromCapturedSource};
