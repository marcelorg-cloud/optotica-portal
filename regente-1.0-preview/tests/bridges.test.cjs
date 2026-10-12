"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const bridge=require("../api/bridges.js");
const user="11111111-1111-4111-8111-111111111111";
const request=(method,body={})=>({method,body,headers:{authorization:"Bearer example.opaque.token",host:"local.test",origin:"https://local.test"}});
const response=()=>({statusCode:200,data:null,setHeader(){return this},status(n){this.statusCode=n;return this},json(v){this.data=v;return this}});
function fake({stop=false,existing=[]}={}){
 const calls=[];
 global.fetch=async(url,opt={})=>{
  const x=String(url),m=opt.method||"GET";calls.push({url:x,method:m});
  let v=[];if(x.includes("/auth/v1/user"))v={id:user};
  else if(x.includes("/system_admins?"))v=[{user_id:user}];
  else if(x.includes("/regente10_controls?"))v=[{emergency_stop:stop}];
  else if(x.includes("regente10_hub_bridge_requests?")&&m==="GET")v=existing;
  else if(x.endsWith("/regente10_hub_bridge_requests")&&m==="POST")v=[{id:"22222222-2222-4222-8222-222222222222",status:"pending"}];
  else throw Error("Unexpected tool request "+x);
  return new Response(JSON.stringify(v),{status:200,headers:{"Content-Type":"application/json"}});
 };
 return calls;
}
test("requires Master session",async()=>{
 fake();const r=response(),q=request("GET");q.headers.authorization="";
 await bridge(q,r);assert.equal(r.statusCode,401);
});
test("rejects request from foreign web origin",async()=>{
 const q=request("POST",{bridge:"github",operation:"status_read"});q.headers.origin="https://evil.invalid";const r=response();
 await bridge(q,r);assert.equal(r.statusCode,403);
});
test("GET returns only own bridge history and no write permissions",async()=>{
 const calls=fake(),r=response();await bridge(request("GET"),r);
 assert.equal(r.statusCode,200);assert.equal(r.data.writeAvailable,false);
 assert(calls.some(x=>x.url.includes("owner_id=eq."+user)));
});
test("rejects arbitrary operation and arguments",async()=>{
 const calls=fake(),r=response();await bridge(request("POST",{bridge:"github",operation:"delete_repository",anything:"x"}),r);
 assert.equal(r.statusCode,400);assert(!calls.some(x=>x.method==="POST"));
});
test("stop disables bridge requests",async()=>{
 const calls=fake({stop:true}),r=response();await bridge(request("POST",{bridge:"github",operation:"status_read"}),r);
 assert.equal(r.statusCode,423);assert(!calls.some(x=>x.url.endsWith("regente10_hub_bridge_requests")&&x.method==="POST"));
});
test("submits a read-only request without credentials or task instructions",async()=>{
 const calls=fake(),r=response();await bridge(request("POST",{bridge:"canva",operation:"capabilities_read"}),r);
 assert.equal(r.statusCode,201);assert.equal(r.data.request.status,"pending");
 assert(!calls.some(x=>x.url.includes("api.canva.com")));
 assert(calls.some(x=>x.url.endsWith("/regente10_hub_bridge_requests")&&x.method==="POST"));
});
test("blocks simultaneous requests to same hub",async()=>{
 const pending=[{id:"x",bridge_id:"canva",status:"pending"}];
 fake({existing:pending});const r=response();await bridge(request("POST",{bridge:"canva",operation:"status_read"}),r);
 assert.equal(r.statusCode,409);
});
