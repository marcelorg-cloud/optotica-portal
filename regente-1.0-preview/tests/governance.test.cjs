"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
process.env.SUPABASE_URL="https://example.supabase.co";process.env.SUPABASE_PUBLISHABLE_KEY="public-test-only";
const governance=require("../api/governance.js");
const USER="11111111-1111-4111-8111-111111111111",MISSION="22222222-2222-4222-8222-222222222222";
const resource={alias:"INST/REGENTE-RLS",owner_kind:"institute",owner_project:null,share_category:"institutional_common",data_class:"internal",allowed_operations:["status.read"],shared_projects:[],lifecycle:"active"};
const route={id:"RT-F3-RLS",participant_id:"F3",resource_alias:resource.alias,operation:"status.read",route_type:"api_direct",availability:"configured",project_scopes:["*"],data_class_max:"internal",cost_known:true,unit_cost:0,write_enabled:false};
const proj={id:"ensavim",label:"ENSAVIM",status:"active"};
const part={id:"F3",name:"Supabase",kind:"tool",project_scopes:["*"],lifecycle:"active"};
const ms={id:MISSION,owner_id:USER,project:"ensavim",status:"afinamento",paused:false,envelope_approved_at:null};
const req=(method="GET",action="catalog",body={})=>({method,query:{action,missionId:MISSION},body:{...body,action},headers:{host:"local.test",origin:"https://local.test",authorization:"Bearer example.jwt.token"}});
const res=()=>({statusCode:200,data:null,setHeader(){return this},status(n){this.statusCode=n;return this},json(o){this.data=o;return this}});
function stub({stop=false}={}){
 const calls=[];
 global.fetch=async (input,opt={})=>{
  const url=String(input),method=opt.method||"GET";
  calls.push({url,method,body:opt.body||null});
  let data=[];
  if(url.endsWith("/auth/v1/user"))data={id:USER};
  else if(url.includes("/system_admins?"))data=[{user_id:USER}];
  else if(url.includes("/regente10_controls?"))data=[{emergency_stop:stop}];
  else if(url.includes("/regente10_missions?"))data=[ms];
  else if(url.includes("/regente10_projects?"))data=[proj];
  else if(url.includes("/regente10_participants?"))data=[part];
  else if(url.includes("/regente10_resources?"))data=[resource];
  else if(url.includes("/regente10_routes?"))data=[route];
  else if(url.includes("/regente10_adapter_checks?"))data=[];
  else if(url.includes("/regente10_mission_connection_maps?"))data=method==="POST"?[{selection:{policy:"test"},state:"draft"}]:[];
  else if(url.includes("/regente10_s00_simulations"))data=method==="POST"?[{id:"33333333-3333-4333-8333-333333333333"}]:[];
  else throw Error("unexpected "+url);
  return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
 };
 return calls;
}
test("governance requires authenticated Master",async()=>{
 stub();const q=req();q.headers.authorization="";const r=res();
 await governance(q,r);assert.equal(r.statusCode,401);
});
test("governance mutation rejects foreign web origin",async()=>{
 const q=req("POST","prepare_map",{missionId:MISSION});q.headers.origin="https://attacker.invalid";
 const r=res();await governance(q,r);assert.equal(r.statusCode,403);
});
test("governance catalog returns only alias metadata with no write",async()=>{
 const calls=stub(),r=res();await governance(req(),r);
 assert.equal(r.statusCode,200);assert.equal(r.data.externalWritesEnabled,false);
 assert.deepEqual(r.data.resources.map(x=>x.alias),["INST/REGENTE-RLS"]);
 assert(!calls.some(c=>c.url.includes("api.github.com")||c.url.includes("api.openai.com")));
});
test("preparation creates only a draft map, never a route activation",async()=>{
 const calls=stub(),r=res();
 await governance(req("POST","prepare_map",{missionId:MISSION}),r);
 assert.equal(r.statusCode,200);assert.equal(r.data.operativeAuthorization,false);
 const inserted=calls.find(c=>c.url.includes("/regente10_mission_connection_maps?")&&c.method==="POST");
 assert(inserted);
 const obj=JSON.parse(inserted.body);assert.equal(obj.state,"draft");assert.equal(obj.selection.externalWritingEnabled,false);
});
test("policy simulator denies unenveloped external operation and records a non-grant",async()=>{
 const calls=stub(),r=res();
 await governance(req("POST","simulate",{missionId:MISSION,participantId:"F3",resourceAlias:resource.alias,operation:"status.read",routeId:route.id}),r);
 assert.equal(r.statusCode,200);assert.equal(r.data.scenario,"would_deny");assert.equal(r.data.operativeAuthorization,false);
 assert(calls.some(c=>c.url.endsWith("/regente10_s00_simulations")&&c.method==="POST"));
});
test("emergency stop blocks even simulated plan persistence",async()=>{
 const calls=stub({stop:true}),r=res();
 await governance(req("POST","prepare_map",{missionId:MISSION}),r);
 assert.equal(r.statusCode,423);assert(!calls.some(c=>c.url.includes("mission_connection_maps")&&c.method==="POST"));
});
