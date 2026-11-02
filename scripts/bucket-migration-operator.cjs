'use strict';
const fs=require('node:fs'),{createBucketMigrationOperator,validateReview,checkEnvironment}=require('../referee-seats/functions/bucket-migration-operator.cjs');
const usage='Usage: node scripts/bucket-migration-operator.cjs preflight --runtime MODE --project PROJECT --token-file FILE --action activate|rollback --code CODE --epoch EPOCH --out FILE\n       node scripts/bucket-migration-operator.cjs inspect --plan FILE\n       node scripts/bucket-migration-operator.cjs commit --runtime MODE --project PROJECT --token-file FILE --plan FILE --expect-digest SHA256';
function parse(argv){
 const [mode,...args]=argv;if(['help','--help'].includes(mode)&&!args.length)return {mode:'help'};
 const allowed={preflight:['runtime','project','token-file','action','code','epoch','out'],inspect:['plan'],commit:['runtime','project','token-file','plan','expect-digest']}[mode];
 if(!allowed)throw Error('invalid-operator-arguments');const options={mode};
 for(let n=0;n<args.length;n+=2){const key=args[n]?.slice(2),value=args[n+1];if(!args[n]?.startsWith('--')||!allowed.includes(key)||Object.hasOwn(options,key)||typeof value!=='string'||!value||value.startsWith('--'))throw Error('invalid-operator-arguments');options[key]=value;}
 if(allowed.some(k=>!options[k]))throw Error('invalid-operator-arguments');
 if(mode!=='inspect'&&!['production','emulator'].includes(options.runtime))throw Error('invalid-bucket-runtime');return options;
}
function readSecure(file,maxBytes){
 let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size<1||stat.size>maxBytes||(stat.mode&0o077)!==0||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw Error('unsafe-operator-file');return fs.readFileSync(fd,'utf8');}
 catch(error){throw Error(error.message==='unsafe-operator-file'?'unsafe-operator-file':'operator-file-unreadable');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function readReview(file){let review;try{review=JSON.parse(readSecure(file,131072));}catch(error){if(['unsafe-operator-file','operator-file-unreadable'].includes(error.message))throw error;throw Error('invalid-migration-review');}return validateReview(review);}
function summary(review,mode){return {ok:true,mode,projectId:review.projectId,action:review.plan.action,code:review.plan.code,epoch:review.plan.epoch,courts:review.plan.courts,buckets:review.plan.buckets,reviewDigest:review.reviewDigest};}
async function run(argv){
 const o=parse(argv);if(o.mode==='help'){process.stdout.write(usage+'\n');return;}
 if(o.mode==='inspect'){process.stdout.write(JSON.stringify(summary(readReview(o.plan),'inspect'))+'\n');return;}
 // Refuse a closed/mismatched environment before reading credentials or SDK init.
 checkEnvironment(o.project,o.runtime,process.env);
 const token=readSecure(o['token-file'],16384).trim();if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token))throw Error('operator-token-required');
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');
 const app=initializeApp({projectId:o.project},'bucket-migration-operator');let committing=false;
 const deadline=setTimeout(()=>{process.stderr.write(JSON.stringify({ok:false,reason:committing?'migration-outcome-unknown':'migration-preflight-timeout'})+'\n');process.exit(2);},120000);
 try{
  const operator=createBucketMigrationOperator({db:getFirestore(app),auth:getAuth(app),projectId:o.project,runtime:o.runtime});
  if(o.mode==='preflight'){
   const review=await operator.preflight({token,action:o.action,code:o.code,epoch:o.epoch});
   try{fs.writeFileSync(o.out,JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});}catch{throw Error('review-file-not-created');}
   process.stdout.write(JSON.stringify(summary(review,'preflight'))+'\n');
  }else{
   const review=readReview(o.plan);committing=true;const result=await operator.commit({token,review,expectedDigest:o['expect-digest']});
   process.stdout.write(JSON.stringify({ok:true,mode:'commit',projectId:o.project,action:result.action,code:result.code,epoch:result.epoch,courts:result.courts,buckets:result.buckets,operation:result.operation,replayed:result.replayed===true})+'\n');
  }
 }finally{clearTimeout(deadline);await deleteApp(app);}
}
function reason(error){if(typeof error?.code==='string'&&/^auth\/[a-z0-9-]{1,60}$/.test(error.code))return error.code;return /^[a-z][a-z0-9-]{0,79}$/.test(error?.message||'')?error.message:'migration-operator-failed';}
if(require.main===module)run(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({ok:false,reason:reason(error)})+'\n');process.exitCode=1;});
module.exports={parse,readSecure,readReview,summary,run,reason};
