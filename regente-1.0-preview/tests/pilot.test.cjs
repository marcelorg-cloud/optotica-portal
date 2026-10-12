"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const user="11111111-1111-4111-8111-111111111111", missionId="22222222-2222-4222-8222-222222222222",jobId="33333333-3333-4333-8333-333333333333";
process.env.OPENAI_API_KEY="TEST_KEY_NOT_REAL";
const mission=require("../api/mission.js");
const orientation=require("../api/orientation.js");
function res(){const r={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;return this},status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};return r}
function req(method="GET",action="",body=null){return {method,query:{action,id:missionId},body:body||{},headers:{authorization:"Bearer eyF.fake.signature",host:"example.test",origin:"https://example.test"}}}
function mock(options={}){
 const called=[],existing=options.steps||[];
 global.fetch=async(input,init={})=>{
  const url=String(input),u=new URL(url),method=init.method||"GET";
  called.push({url,method});
  let data=[],status=200;
  if(u.pathname==="/auth/v1/user")data={id:user};
  else if(u.pathname.endsWith("/system_admins"))data=[{user_id:user}];
  else if(u.pathname.endsWith("/regente10_missions"))data=[{id:missionId,owner_id:user,project:"born-robot",original_request:"Elaborar um resumo de integração segura do Regente 1.0",status:"afinamento",paused:false}];
  else if(u.pathname.endsWith("/regente10_orientation_steps"))data=method==="POST"?[{id:"44444444-4444-4444-8444-444444444444"}]:existing;
  else if(u.pathname.endsWith("/regente10_controls"))data=[{emergency_stop:!!options.emergency_stop}];
  else if(u.pathname.endsWith("/rpc/regente10_reserve_ai_call"))data=jobId;
  else if(u.pathname.endsWith("/regente10_ai_calls"))data=null;
  else if(u.hostname==="api.openai.com"){
    data={choices:[{message:{content:JSON.stringify({objetivo:"Testar o Afinamento",coerencia:"coerente",criterios_essenciais:["Rastrear evidências"],riscos:[],perguntas:[]})}}]};
  }
  else throw Error("Unexpected request "+method+" "+url);
  return new Response(data===null?"":JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
 };
 return called;
}
test("GET public health does not expose secrets",async()=>{
 const answer=res();await mission(req("GET","health"),answer);
 assert.equal(answer.statusCode,200);
 assert.equal(answer.body.service,"regente10");
 assert.equal(answer.body.externalActionsEnabled,false);
 assert.equal(JSON.stringify(answer.body).includes("TEST_KEY_NOT_REAL"),false);
});
test("orientation rejects missing Master session",async()=>{
 const q=req();q.headers.authorization="";const answer=res();
 await orientation(q,answer);assert.equal(answer.statusCode,401);
});
test("orientation rejects cross-origin mutations before doing any work",async()=>{
 const q=req("POST","",{id:missionId,stage:0});q.headers.origin="https://attacker.invalid";
 const answer=res();await orientation(q,answer);assert.equal(answer.statusCode,403);
});
test("orientation GET returns persisted stage without calling AI",async()=>{
 const called=mock();
 const answer=res();await orientation(req("GET"),answer);
 assert.equal(answer.statusCode,200);assert.equal(answer.body.nextStep,0);
 assert.equal(called.filter(x=>x.url.includes("api.openai.com")).length,0);
});
test("emergency stop prevents new AI reservations",async()=>{
 const called=mock({emergency_stop:true});
 const answer=res();await orientation(req("POST","",{id:missionId,stage:0}),answer);
 assert.equal(answer.statusCode,423);
 assert.equal(called.filter(x=>x.url.includes("api.openai.com")).length,0);
 assert.equal(called.filter(x=>x.url.includes("reserve_ai_call")).length,0);
});
test("C01 invokes real role endpoint and persists result only after DB reservation",async()=>{
 const called=mock();
 const answer=res();await orientation(req("POST","",{id:missionId,stage:0}),answer);
 assert.equal(answer.statusCode,200);
 assert.equal(answer.body.role,"C01");
 assert(called.some(x=>x.url.includes("reserve_ai_call")));
 assert(called.some(x=>x.url.includes("api.openai.com")));
 assert(called.some(x=>x.url.includes("orientation_steps")&&x.method==="POST"));
});
test("pilot emergency stop endpoint does not touch legacy engine",async()=>{
 const called=mock();
 const answer=res();await mission(req("POST","stop_all",{}),answer);
 assert.equal(answer.statusCode,200);assert.equal(answer.body.scope,"somente Regente 1.0");
 assert(called.some(x=>x.url.endsWith("/regente10_controls")));
 assert(!called.some(x=>x.url.includes("/regent_tasks")));
});
