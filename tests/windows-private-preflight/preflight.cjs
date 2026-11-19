'use strict';
// READ ONLY: never spawns Node/npm/Java/Firebase, opens a socket or fetches a URL.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const lab=path.resolve(__dirname,'../full-app-repo/tests/public-score-mobile-lab');
const EXPECTED={node:'22.23.2',jdkMajor:21,jarSha:'9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d',dependencies:{'firebase-admin':'13.10.0','firebase-functions':'6.6.0'},cli:'14.27.0'};
function evaluate({platform,nodeVersion,jdkRelease,jarSha,declared,locked,installed,cliVersion,cliLocked,missing=[]}){
 const blockers=[];if(platform!=='win32')blockers.push('Windows-not-executed');
 if(nodeVersion!==EXPECTED.node)blockers.push('Node-pin-mismatch');
 if(!/^JAVA_VERSION="21(?:[.\"])/m.test(jdkRelease||''))blockers.push('JDK21-release-not-verified');
 if(jarSha!==EXPECTED.jarSha)blockers.push('Firestore-JAR-hash-mismatch-or-missing');
 for(const [name,version]of Object.entries(EXPECTED.dependencies)){if(declared?.[name]!==version||locked?.[name]!==version||installed?.[name]!==version)blockers.push('dependency-pin:'+name);}
 if(cliVersion!==EXPECTED.cli||cliLocked!==EXPECTED.cli)blockers.push('Firebase-CLI-pin');
 for(const name of missing)blockers.push('missing:'+name);
 return {readOnly:true,sourceAndDependencyChecksPassed:blockers.length===0,blockers,launchApproved:false,windowsIntegrationPassed:false,phoneIntegrationPassed:false,
 remaining:['Authorized complete external-read/download inventory','Fresh Windows startup and runtime validation','Manual referee UI/auth/callable -> automatic worker -> edge','Child-process shutdown and zero leftover ports','Private Wi-Fi/iPhone test without firewall changes'],
 note:'Passing these static checks never authorizes startup or proves an executable Windows package.'};
}
function inspect({jar,cliRoot,javaHome,platform=process.platform,nodeVersion=process.versions.node}={}){
 const missing=[];function json(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{missing.push(path.basename(p));return {};}}
 const pkg=json(path.join(lab,'function-tools/package.json')),lock=json(path.join(lab,'function-tools/package-lock.json')),cl=json(path.join(lab,'emulator-tools/package-lock.json'));
 const installed={};for(const name of Object.keys(EXPECTED.dependencies))installed[name]=json(path.join(lab,'function-tools/node_modules',name,'package.json')).version;
 let jarSha,jdkRelease='';try{jarSha=crypto.createHash('sha256').update(fs.readFileSync(jar)).digest('hex');}catch{missing.push('official-firestore-jar');}
 try{jdkRelease=fs.readFileSync(path.join(javaHome,'release'),'utf8');}catch{missing.push('JDK-release-file');}
 for(const name of ['orchestrator.cjs','orchestrator.test.cjs','edge.cjs','read-view.cjs','display.js'])if(!fs.existsSync(path.join(__dirname,name)))missing.push(name);
 const cliVersion=cliRoot?json(path.join(cliRoot,'package.json')).version:undefined;
 return evaluate({platform,nodeVersion,jdkRelease,jarSha,declared:pkg.dependencies,locked:Object.fromEntries(Object.keys(EXPECTED.dependencies).map(k=>[k,lock.packages?.['node_modules/'+k]?.version])),installed,cliVersion,cliLocked:cl.packages?.['node_modules/firebase-tools']?.version,missing});
}
module.exports={evaluate,inspect,EXPECTED};
if(require.main===module){const result=inspect({jar:process.env.ARENA_PREFLIGHT_JAR,cliRoot:process.env.ARENA_PREFLIGHT_CLI_ROOT,javaHome:process.env.JAVA_HOME});console.log(JSON.stringify(result,null,2));process.exitCode=result.sourceAndDependencyChecksPassed?0:2;}
