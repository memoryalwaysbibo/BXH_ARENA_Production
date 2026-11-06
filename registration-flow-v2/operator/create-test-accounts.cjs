'use strict';
// Dedicated test-project setup. No service-account key or password is printed.
// This prepares ready-to-login players, not the account-signup/numbering flow.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function options(args){
 const out={count:50,apply:false};
 for(let i=0;i<args.length;i++){
  const k=args[i];if(k==='--apply')out.apply=true;
  else if(k==='--allow-production')out.allowProduction=true;
  else if(['--project','--run','--credentials-file','--count'].includes(k))out[k.slice(2)]=args[++i];
  else throw Error('unknown-option');
 }
 out.count=Number(out.count);
 if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(out.project||''))throw Error('firebase-project-required');
 if(out.project==='bxh-arena'&&!out.allowProduction)throw Error('production-needs-explicit-flag');
 if(out.project!=='bxh-arena'&&out.allowProduction)throw Error('production-flag-project-mismatch');
 if(!/^[a-z0-9-]{4,30}$/.test(out.run||'')||!Number.isInteger(out.count)||out.count<1||out.count>150)throw Error('invalid-run-or-count');
 const ah=process.env.FIREBASE_AUTH_EMULATOR_HOST,fh=process.env.FIRESTORE_EMULATOR_HOST;
 if(ah||fh){if(!/^127\.0\.0\.1:\d+$/.test(ah||'')||!/^127\.0\.0\.1:\d+$/.test(fh||'')||!out.project.startsWith('demo-'))throw Error('both-loopback-emulators-required');}
 else if(out.project.startsWith('demo-'))throw Error('demo-project-requires-emulators');
 if(out.apply&&!out['credentials-file'])throw Error('private-credentials-file-required');
 return out;
}
function identities(o){return Array.from({length:o.count},(_,i)=>{const n=String(i+1).padStart(3,'0');return {uid:'loadtest_'+o.run+'_'+n,email:'bxh.loadtest.'+o.run+'.'+n+'@example.test',name:'壓測玩家'+n};});}
async function main(args){
 const o=options(args),rows=identities(o);
 if(!o.apply){console.log(JSON.stringify({mode:'plan-only',project:o.project,run:o.run,count:rows.length,cloudWrites:0,firstEmail:rows[0].email,lastEmail:rows.at(-1).email}));return;}
 const file=path.resolve(o['credentials-file']);let credentials,resuming=false;
 if(fs.existsSync(file)){
  if(fs.lstatSync(file).isSymbolicLink()||(fs.statSync(file).mode&0o077)!==0)throw Error('credentials-file-must-be-private');
  credentials=JSON.parse(fs.readFileSync(file,'utf8'));resuming=true;
  if(credentials.project!==o.project||credentials.run!==o.run||credentials.accounts?.length!==rows.length||!rows.every((r,i)=>r.uid===credentials.accounts[i].uid&&r.email===credentials.accounts[i].email&&typeof credentials.accounts[i].password==='string'&&credentials.accounts[i].password.length>=20))throw Error('credentials-file-mismatch');
 }else{
  credentials={version:1,project:o.project,run:o.run,accounts:rows.map(r=>({...r,password:crypto.randomBytes(24).toString('base64url')}))};
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(credentials,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 const {initializeApp,applicationDefault,deleteApp}=require('firebase-admin/app');
 const {getAuth}=require('firebase-admin/auth'),{getFirestore,FieldValue}=require('firebase-admin/firestore');
 const emulated=!!process.env.FIREBASE_AUTH_EMULATOR_HOST;
 const app=initializeApp({projectId:o.project,...(!emulated?{credential:applicationDefault()}:{})});
 const auth=getAuth(app),db=getFirestore(app);let created=0,ready=0;
 try{
  for(const r of credentials.accounts){
   const ref=db.doc('users/'+r.uid),profile=await ref.get();
   if(profile.exists&&profile.data().loadTestRun!==o.run)throw Error('existing-profile-not-owned');
   let user;try{user=await auth.getUser(r.uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
   if(user){if(!resuming||user.email!==r.email||user.disabled)throw Error('existing-auth-not-owned');}
   else{await auth.createUser({uid:r.uid,email:r.email,password:r.password,displayName:r.name,emailVerified:false,disabled:false});created++;}
   if(!profile.exists)await ref.create({active:true,role:'player',realName:r.name,nickname:r.name,gameId:r.uid,displayName:r.name,email:r.email,phone:'0000000000',profileCompleted:true,loadTestRun:o.run,loadTestAccount:true,createdAt:FieldValue.serverTimestamp()});
   const after=await auth.getUser(r.uid),data=(await ref.get()).data();
   if(after.disabled||after.email!==r.email||data?.active!==true||data?.role!=='player'||data?.loadTestRun!==o.run)throw Error('account-readback-mismatch');
   ready++;
  }
  console.log(JSON.stringify({mode:emulated?'emulator-only':o.project==='bxh-arena'?'production-test-accounts':'test-cloud-project',project:o.project,run:o.run,created,ready,credentialsSaved:true,passwordsPrinted:false,tournamentWrites:0,cloudReady:!emulated}));
 }finally{await db.terminate();await deleteApp(app);}
}
module.exports={options,identities,main};
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(JSON.stringify({status:'blocked',reason:e.code||e.message,cloudReady:false}));process.exitCode=1;});
