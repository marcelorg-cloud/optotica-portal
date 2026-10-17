"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const inventory=require("../network-catalog.json");
const network=require("../api/network.js");
const UID="11111111-1111-4111-8111-111111111111";

function response(){
 return {code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
  status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
}
function request(authorization){
 return {method:"GET",headers:authorization?{authorization}:{},body:null};
}

test("the panel loads the catalog only from the already authenticated /api/network",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../network.html"),"utf8");
 const build=fs.readFileSync(path.join(__dirname,"../scripts/build-public.cjs"),"utf8");
 const config=require("../vercel.json");
 assert.match(html,/const catalog=live\.catalog/);
 assert.match(html,/req\("GET","\/api\/network"\)/);
 assert.doesNotMatch(html,/fetch\("\/network-catalog\.json"\)/);
 assert.doesNotMatch(html,/\/api\/panel\?view=catalog/);
 assert.doesNotMatch(build,/fs\.copyFileSync\([^\n]*network-catalog\.json/);
 assert.equal(config.functions["api/network.js"].includeFiles,"network-catalog.json");
 assert.equal(inventory.nodes.length,21);
});

test("only active Master receives the catalog through the network API",async()=>{
 const originalFetch=global.fetch;
 let isMaster=true,fetchCalls=0;
 global.fetch=async resource=>{
  fetchCalls++;
  const url=String(resource);
  const json=x=>new Response(JSON.stringify(x),{status:200,headers:{"Content-Type":"application/json"}});
  if(url.includes("/auth/v1/user"))return json({id:UID});
  if(url.includes("/rest/v1/system_admins?"))return json(isMaster?[{user_id:UID}]:[]);
  if(url.includes("/rest/v1/regente10_adapter_checks?"))
   return json([{node_id:"F1",operation:"read",state:"pronto",checked_at:"2026-10-16T00:00:00Z"}]);
  throw Error("Unrecognized fetch in network catalog regression test");
 };
 try{
  const anonymous=response();
  await network(request(),anonymous);
  assert.equal(anonymous.code,403);
  assert.equal(anonymous.body.catalog,undefined);
  assert.equal(fetchCalls,0);

  isMaster=false;
  const notMaster=response();
  await network(request("Bearer test-token"),notMaster);
  assert.equal(notMaster.code,403);
  assert.equal(notMaster.body.catalog,undefined);

  isMaster=true;
  const allowed=response();
  await network(request("Bearer test-token"),allowed);
  assert.equal(allowed.code,200);
  assert.equal(allowed.headers["Cache-Control"],"no-store");
  assert.deepEqual(allowed.body.catalog,inventory);
  assert.equal(allowed.body.catalog.nodes.length,21);
  assert.equal(allowed.body.checks.length,1);
 }finally{
  global.fetch=originalFetch;
 }
});
