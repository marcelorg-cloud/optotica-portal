"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="test_public_not_secret";
const budget=require("../api/budget.js");
const USER="11111111-1111-4111-8111-111111111111";
const ID="22222222-2222-4222-8222-222222222222";
function req(method="GET",body={},query={missionId:ID}){
 return {method,body,query,headers:{authorization:"Bearer test.jwt.mock",host:"example.test",origin:"https://example.test"}};
}
function res(){return {statusCode:200,body:null,setHeader(){return this},status(n){this.statusCode=n;return this},json(x){this.body=x;return this}}}
const sample={mission_id:ID,owner_id:USER,state:"draft",currency:"BRL",estimated_text_brl:0.75,estimated_other_brl:10,estimated_total_brl:10.75,margin_pct:50,cap_brl:16.125,fx_brl_per_usd:5,reserved_brl:0,metered_brl:0};
function mock({legacy=false,paused=false,status="aguardando_autorizacao"}={}){
 const calls=[];
 global.fetch=async(uri,opt={})=>{
  const url=String(uri),method=opt.method||"GET";calls.push({url,method,body:opt.body});
  let value=[];
  if(url.includes("/auth/v1/user"))value={id:USER};
  else if(url.includes("/system_admins?"))value=[{user_id:USER}];
  else if(url.includes("/regente10_missions?"))value=[{id:ID,owner_id:USER,project:"born-robot",status,paused,budget_policy:legacy?"legacy":"budget_v1"}];
  else if(url.includes("/regente10_mission_budgets?"))value=[sample];
  else if(url.endsWith("/rpc/regente10_budget_submit"))value={state:"draft",estimated_total_brl:10.75,cap_brl:16.125};
  else if(url.endsWith("/rpc/regente10_budget_approve"))value={state:"approved",cap_brl:16.125};
  else throw Error("Unexpected mock request "+url);
  return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
 };
 return calls;
}
test("budget GET requires authenticated Master",async()=>{
 mock();const r=res(),q=req();q.headers.authorization="";
 await budget(q,r);assert.equal(r.statusCode,401);
});
test("budget GET responds with provider price source and BRL assumption disclosure",async()=>{
 const calls=mock(),r=res();await budget(req(),r);
 assert.equal(r.statusCode,200);assert.equal(r.body.pricing.model,"gpt-4.1-mini");
 assert.equal(r.body.budget.state,"draft");assert.equal(r.body.pricing.fxSource,"assunção informada pelo Maestro");
 assert(!calls.some(x=>x.url.includes("api.openai.com")));
});
test("budget POST rejects forged Origin",async()=>{
 const calls=mock(),q=req("POST",{missionId:ID,action:"draft",fx:5,marginPct:50,otherEstimate:0}),r=res();
 q.headers.origin="https://other.example";await budget(q,r);assert.equal(r.statusCode,403);assert.equal(calls.length,0);
});
test("budget approval requires explicit confirmation",async()=>{
 const calls=mock(),r=res();await budget(req("POST",{missionId:ID,action:"approve",confirm:false}),r);
 assert.equal(r.statusCode,400);assert(!calls.some(x=>x.url.endsWith("/rpc/regente10_budget_approve")));
});
test("budget draft validates FX and margin",async()=>{
 const calls=mock(),r=res();await budget(req("POST",{missionId:ID,action:"draft",fx:0,marginPct:350,otherEstimate:0}),r);
 assert.equal(r.statusCode,400);assert(!calls.some(x=>x.url.endsWith("/rpc/regente10_budget_submit")));
});
test("budget draft only uses dedicated SQL RPC, not provider tools",async()=>{
 const calls=mock(),r=res();await budget(req("POST",{missionId:ID,action:"draft",fx:5,marginPct:50,otherEstimate:10}),r);
 assert.equal(r.statusCode,200);assert.equal(r.body.result.state,"draft");
 const rpc=calls.find(x=>x.url.endsWith("/rpc/regente10_budget_submit"));
 assert(rpc);assert.deepEqual(JSON.parse(rpc.body),{p_mission_id:ID,p_fx:5,p_other_estimate:10,p_margin_pct:50});
});
test("budget approval binds same human Master to explicit new mission",async()=>{
 const calls=mock(),r=res();await budget(req("POST",{missionId:ID,action:"approve",confirm:true}),r);
 assert.equal(r.statusCode,200);assert.equal(r.body.result.state,"approved");
 assert(calls.some(x=>x.url.endsWith("/rpc/regente10_budget_approve")));
});
test("budget legacy missions cannot be approved retroactively",async()=>{
 const calls=mock({legacy:true}),r=res();await budget(req("POST",{missionId:ID,action:"approve",confirm:true}),r);
 assert.equal(r.statusCode,409);assert(!calls.some(x=>x.url.endsWith("/rpc/regente10_budget_approve")));
});
test("budget draft refuses paused mission",async()=>{
 const calls=mock({paused:true}),r=res();await budget(req("POST",{missionId:ID,action:"draft",fx:5,marginPct:50,otherEstimate:0}),r);
 assert.equal(r.statusCode,423);assert(!calls.some(x=>x.url.endsWith("/rpc/regente10_budget_submit")));
});
test("budget draft is restricted to post-Afinamento",async()=>{
 const calls=mock({status:"afinamento"}),r=res();await budget(req("POST",{missionId:ID,action:"draft",fx:5,marginPct:50,otherEstimate:0}),r);
 assert.equal(r.statusCode,409);assert(!calls.some(x=>x.url.endsWith("/rpc/regente10_budget_submit")));
});
