'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.equal(process.versions.node,'22.23.2');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));const base=__dirname;const versions={};
for(const [dir,pins]of Object.entries({functions:{'firebase-admin':'13.10.0','firebase-functions':'6.6.0','@firebase/database-compat':'2.1.7','@firebase/database':'1.1.5'},frontend:{firebase:'11.10.0',playwright:'1.55.0',esbuild:'0.25.5','@esbuild/win32-x64':'0.25.5'},cli:{'firebase-tools':'14.27.0'}})){
 const lock=read(path.join(base,dir,'package-lock.json'));for(const[name,version]of Object.entries(pins)){const m=read(path.join(base,dir,'node_modules',name,'package.json'));assert.equal(m.version,version);assert.equal(lock.packages['node_modules/'+name].version,version);versions[dir+'/'+name]=version;}
}
const javaRelease=fs.readFileSync(path.join(process.env.JAVA_HOME,'release'),'utf8');assert.match(javaRelease,/JAVA_VERSION="21(?:[.\"])/);
const eb=path.join(base,'frontend/node_modules/@esbuild/win32-x64/esbuild.exe');assert(fs.statSync(eb).isFile());
const result={passed:true,platform:process.platform,arch:process.arch,node:process.versions.node,java21ReleaseVerified:true,versions,esbuildWindowsBinaryPresent:true,emulatorStarted:false,cliStarted:false,appStarted:false,browserStarted:false,windowsEndToEnd:false,iPhoneTested:false};fs.mkdirSync(path.join(base,'evidence'),{recursive:true});fs.writeFileSync(path.join(base,'evidence/result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
