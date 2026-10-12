"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="test_publishable";
process.env.COMPOSIO_API_KEY="fake_composio_secret_test";
const handler=require("../api/composio.js"),{inventory,providerGet}=require("../lib/composio-readonly.js");
const UID="11111111-1111-4111-8111-111111111111",SECRET=process.env.COMPOSIO_API_KEY;
const req=(method="GET",query={action:"status"})=>({method,query,headers:{authorization:"Bearer fake.jwt.test",host:"example.test"}});
const res=()=>({statusCode:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}});
function mock({admin=true,emergency=false,reject=false,malformed=false,controlFailure=false,sessionFailure=false}={}){
 const calls=[];
 global.fetch=async(url,opt={})=>{
  calls.push({url:String(url),method:opt.method||"GET",headers:opt.headers});let status=200,data;
  if(String(url).includes("/auth/v1/user")){data={id:UID};if(sessionFailure)status=401;}
  else if(String(url).includes("/system_admins?"))data=admin?[{user_id:UID}]:[];
  else if(String(url).includes("/regente10_controls?")){data=[{emergency_stop:emergency}];if(controlFailure)status=500;}
  else if(String(url).startsWith("https://backend.composio.dev/api/v3.1/")){
   if(reject){status=401;data={error:SECRET};}
   else if(malformed)data={other:[]};
   else if(String(url).includes("auth_configs"))data={items:[{id:"ac_test",toolkit:{slug:"github"},auth_scheme:"OAUTH2",status:"ENABLED",is_composio_managed:true,credentials:{api_key:SECRET},shared_credentials:{password:SECRET},proxy_config:{proxy_auth_key:SECRET}}]};
   else data={items:[{id:"ca_test",toolkit:{slug:"github"},status:"ACTIVE",auth_config:{id:"ac_test",auth_scheme:"OAUTH2"},state:{val:{oauth_token:SECRET,proxy_password:SECRET}},data:{secret:SECRET},user_id:"private-person",alias:SECRET}],next_cursor:null};
  }else throw Error("Unexpected request");
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
 };
 return calls;
}
test("anonymous request cannot probe provider",async()=>{const calls=mock(),q=req(),r=res();q.headers={};await handler(q,r);assert.equal(r.statusCode,401);assert.equal(calls.length,0)});
test("expired session cannot probe provider",async()=>{const calls=mock({sessionFailure:true}),r=res();await handler(req(),r);assert.equal(r.statusCode,401);assert.equal(calls.length,1)});
test("non-Master cannot see project inventory",async()=>{const calls=mock({admin:false}),r=res();await handler(req(),r);assert.equal(r.statusCode,403);assert(!calls.some(x=>x.url.includes("composio.dev")))});
test("emergency stop blocks inventory provider requests",async()=>{const calls=mock({emergency:true}),r=res();await handler(req(),r);assert.equal(r.statusCode,423);assert(!calls.some(x=>x.url.includes("composio.dev")))});
test("unavailable controls fail closed",async()=>{const calls=mock({controlFailure:true}),r=res();await handler(req(),r);assert.equal(r.statusCode,503);assert(!calls.some(x=>x.url.includes("composio.dev")))});
test("POST cannot create configs or connect accounts",async()=>{const calls=mock(),r=res();await handler(req("POST"),r);assert.equal(r.statusCode,405);assert.equal(calls.length,0)});
test("client cannot select user, provider URL, action or project",async()=>{for(const query of [{userId:"other"},{action:"execute"},{url:"https://evil.test"},{projectId:"other"}]){const calls=mock(),r=res();await handler(req("GET",query),r);assert.equal(r.statusCode,400);assert.equal(calls.length,0)}});
test("successful inventory strips all credential-bearing structures and never grants execution",async()=>{
 const calls=mock(),r=res();await handler(req(),r);assert.equal(r.statusCode,200);assert.equal(r.body.activeAccounts,1);assert.equal(r.body.externalWritesEnabled,false);assert.equal(r.body.toolExecutionEnabled,false);assert.equal(r.body.accounts[0].operationallyAuthorized,false);
 const encoded=JSON.stringify(r.body);for(const value of [SECRET,"private-person","oauth_token","credentials","proxy_auth_key"])assert(!encoded.includes(value));
 const upstream=calls.filter(x=>x.url.includes("composio.dev"));assert.equal(upstream.length,2);assert(upstream.every(x=>x.method==="GET"&&x.headers["x-api-key"]===SECRET&&!x.headers.Authorization));assert(upstream.some(x=>x.url.includes("account_type=PRIVATE")));assert.equal(r.headers["Cache-Control"],"no-store");
});
test("provider rejects key without echoing raw error",async()=>{mock({reject:true});const r=res();await handler(req(),r);assert.equal(r.statusCode,502);assert.equal(r.body.code,"credential_rejected");assert(!JSON.stringify(r.body).includes(SECRET))});
test("provider diagnostics retain HTTP status and safe request ID without error payload",async()=>{
 const fetcher=async()=>new Response(JSON.stringify({error:{request_id:"req_diagnostic_123",message:SECRET,suggested_fix:SECRET}}),{status:403});
 await assert.rejects(()=>providerGet("configs",{apiKey:SECRET,fetcher}),e=>e.providerStatus===403&&e.providerRequestId==="req_diagnostic_123"&&!JSON.stringify(e).includes(SECRET));
});
test("provider diagnostics cannot echo a key hidden in request ID",async()=>{
 const fetcher=async()=>new Response(JSON.stringify({error:{request_id:"req_"+SECRET}}),{status:401});
 await assert.rejects(()=>providerGet("configs",{apiKey:SECRET,fetcher}),e=>e.providerStatus===401&&!e.providerRequestId&&!JSON.stringify(e).includes(SECRET));
});
test("malformed provider response is not a verified empty inventory",async()=>{mock({malformed:true});const r=res();await handler(req(),r);assert.equal(r.statusCode,502);assert.equal(r.body.code,"invalid_response");assert(!r.body.credentialAccepted)});
test("missing key has no provider request",async()=>{let called=false;await assert.rejects(()=>providerGet("configs",{apiKey:"",fetcher:async()=>{called=true}}),e=>e.code==="not_configured");assert.equal(called,false)});
test("arbitrary provider paths rejected before network",async()=>{await assert.rejects(()=>providerGet("tools/execute",{apiKey:SECRET}),e=>e.code==="invalid_query")});
test("network errors cannot leak secret-bearing messages",async()=>{await assert.rejects(()=>providerGet("configs",{apiKey:SECRET,fetcher:async()=>{throw Object.assign(new Error(SECRET),{code:"ECONNRESET"})}}),e=>e.code==="provider_unavailable"&&!e.message.includes(SECRET))});
test("unknown states are not counted active and truncated inventory is disclosed",async()=>{
 const fetcher=async()=>new Response(JSON.stringify({items:[{id:"ca_other",toolkit:{slug:"github"},status:"made_up",state:{api_key:SECRET}}],next_cursor:"page2"}));
 const result=await inventory({apiKey:SECRET,fetcher});assert.equal(result.activeAccounts,0);assert.equal(result.hasMore,true);assert.equal(result.accounts[0].status,"UNKNOWN");
});
