"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const ID="12345678-1234-4234-8234-123456789abc",USER="87654321-4321-4432-8432-cba987654321";
process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="public-test-key";
process.env.OPENAI_API_KEY="test-placeholder-not-sent";
const network=require("../api/network.js"),agents=require("../api/agents.js");
const req=(method,body={},query={})=>({method,body,query,headers:{host:"local.test",origin:"https://local.test",authorization:"Bearer test.token.fake"}});
const res=()=>({statusCode:200,value:null,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(v){this.value=v;return this}});
function mock({emergency=false,approved=true}={}){
 const calls=[];
 global.fetch=async(input,opt={})=>{
  const url=String(input),method=opt.method||"GET";calls.push({url,method});
  const uri=new URL(url);let value=[];
  if(uri.pathname==="/auth/v1/user")value={id:USER};
  else if(uri.pathname.endsWith("/system_admins"))value=[{user_id:USER}];
  else if(uri.pathname.endsWith("/regente10_controls"))value=[{emergency_stop:emergency}];
  else if(uri.pathname.endsWith("/regente10_missions"))value=[{id:ID,owner_id:USER,original_request:"Plano institucional sem pessoas",prompt_affinado:"Plano textual",envelope_approved_at:approved?new Date().toISOString():null,status:"em_execucao",paused:false}];
  else if(uri.pathname.endsWith("/regente10_network_runs"))value=method==="POST"?[{id:"run-1"}]:[];
  else if(uri.pathname.endsWith("/regente10_adapter_checks"))value=method==="POST"?null:[];
  else if(uri.pathname.endsWith("/regente10_ai_calls"))value=null;
  else if(uri.pathname.endsWith("/rpc/regente10_reserve_ai_call"))value="33333333-3333-4333-8333-333333333333";
  else if(uri.hostname==="api.github.com")value={full_name:"marcelorg-cloud/optotica-portal"};
  else if(uri.hostname==="api.openai.com")value={choices:[{message:{content:"## Relatório real de texto; nenhuma publicação efetuada."}}]};
  else throw Error("Unexpected mocked request: "+url);
  return new Response(value===null?"":JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
 };
 return calls;
}
test("network: anonymous caller cannot list tools",async()=>{
 const q=req("GET");q.headers.authorization="";
 const r=res();await network(q,r);
 assert.notEqual(r.statusCode,200);
});
test("network: catalogue status has no write authorization",async()=>{
 mock();const r=res();await network(req("GET"),r);
 assert.equal(r.statusCode,200);
 assert.equal(r.value.writePermission,undefined);
 assert.match(r.value.scope,/nenhum instrumento externo habilitado/);
});
test("network: tool F4 remains unknown without adapter",async()=>{
 const calls=mock();
 const r=res();await network(req("POST",{node:"F4"}),r);
 assert.equal(r.statusCode,200);assert.equal(r.value.state,"desconhecido");
 assert(!calls.some(x=>x.url.includes("replicate.com")));
});
test("network: tool F1 probe verifies read only",async()=>{
 const calls=mock();const r=res();await network(req("POST",{node:"F1"}),r);
 assert.equal(r.statusCode,200);assert.equal(r.value.state,"pronto");
 assert(calls.some(x=>x.url.includes("api.github.com/repos/")));
 assert(!calls.some(x=>x.method==="PATCH"&&x.url.includes("github.com")));
});
test("network: stop blocks new probes",async()=>{
 const calls=mock({emergency:true});const r=res();await network(req("POST",{node:"F1"}),r);
 assert.equal(r.statusCode,423);assert(!calls.some(x=>x.url.includes("api.github.com")));
});
test("agents: GET lists no outputs, no paid calls",async()=>{
 const calls=mock();const r=res();await agents(req("GET",{}, {missionId:ID}),r);
 assert.equal(r.statusCode,200);assert.deepEqual(r.value.runs,[]);
 assert(!calls.some(x=>x.url.includes("api.openai.com")));
});
test("agents: approval needed before A1",async()=>{
 const calls=mock({approved:false});const r=res();await agents(req("POST",{missionId:ID,node:"A1"}),r);
 assert.equal(r.statusCode,403);assert(!calls.some(x=>x.url.includes("api.openai.com")));
});
test("agents: A1 invokes real agent and persists document with reserved budget",async()=>{
 const calls=mock(),r=res();await agents(req("POST",{missionId:ID,node:"A1"}),r);
 assert.equal(r.statusCode,200);
 assert(calls.some(x=>x.url.includes("reserve_ai_call")));
 assert(calls.some(x=>x.url.includes("api.openai.com")));
 assert(calls.some(x=>x.url.includes("regente10_network_runs")&&x.method==="POST"));
});
test("agents: manual A6 stores review without invoking provider",async()=>{
 const calls=mock(),r=res();
 await agents(req("POST",{missionId:ID,node:"A6",review:"Parecer de revisão externa informado pelo operador, sem acesso direto à API do provedor."}),r);
 assert.equal(r.statusCode,200);assert(!calls.some(x=>x.url.includes("api.openai.com")));
});
