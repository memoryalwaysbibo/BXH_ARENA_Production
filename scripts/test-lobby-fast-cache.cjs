const fs=require("fs"),vm=require("vm"),assert=require("assert");
const code=fs.readFileSync("lobby-fast-cache.js","utf8");
function env(seed={}){
 const data=new Map(Object.entries(seed)); const localStorage={getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
 const ctx={window:{localStorage},localStorage,Date,JSON};ctx.window.window=ctx.window;vm.createContext(ctx);vm.runInContext(code,ctx);return{api:ctx.window.BXHLobbyFastCache,data};
}
const now=Date.now();
let e=env(); assert.equal(e.api.read(),null,"empty cache must miss");
assert.equal(e.api.write([{code:"BXH-TEST",name:"Test",email:"secret@example.com",phone:"0900",assignedStaffUids:["x"],bracketView:"{}"}]),true);
let r=e.api.read();assert.equal(r.items.length,1);assert.equal(r.items[0].code,"BXH-TEST");assert.equal("email" in r.items[0],false);assert.equal("phone" in r.items[0],false);assert.equal("assignedStaffUids" in r.items[0],false);
const key=e.api.key;const stale=JSON.stringify({schema:1,savedAt:now-(7*60*60*1000),items:[{code:"OLD"}]});e=env({[key]:stale});assert.equal(e.api.read(),null,"expired cache must miss");
e=env();e.api.write([{code:"A",updatedAt:1}]);e.api.write([{code:"A",updatedAt:2},{code:"B",updatedAt:3}]);r=e.api.read();assert.equal(r.items.length,2);assert.equal(r.items[0].updatedAt,2);
e=env();e.api.write(Array.from({length:200},(_,i)=>({code:"C"+i})));r=e.api.read();assert.equal(r.items.length,160,"cache cap");
console.log("Lobby fast cache tests PASS");