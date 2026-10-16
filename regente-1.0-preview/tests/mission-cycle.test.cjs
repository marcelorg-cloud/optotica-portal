"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const USER="11111111-1111-4111-8111-111111111111";
const MID="22222222-2222-4222-8222-222222222222";
process.env.SUPABASE_URL="https://fake.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="public-synthetic-no-secret";
process.env.OPENAI_API_KEY="test-only-not-real";
const orient=require("../api/orientation.js"),missionHandler=require("../api/mission.js");
const req=(method,action,body)=>({method,query:{id:MID,action},body:body||{},headers:{
 authorization:"Bearer token.fake.signature",host:"regente.test",origin:"https://regente.test"}});
const response=()=>({statusCode:200,body:null,setHeader(){return this},status(n){this.statusCode=n;return this},json(x){this.body=x;return this}});
async function send(handler,method,action,body){
 const r=response();await handler(req(method,action,body),r);
 assert.equal(r.statusCode,200,"Failed "+method+" "+action+": "+JSON.stringify(r.body).slice(0,260));
 return r.body;
}
function fixture(){
 let m={id:MID,owner_id:USER,project:"born-robot",title:"Plano institucional fictício",
 original_request:"Preparar um relatório institucional seguro, sem dados pessoais ou sistemas externos.",
 prompt_affinado:null,result_plan:[],diagnostic:{},status:"afinamento",paused:false,budget_policy:"budget_v1",
 envelope_approved_at:null,created_at:"2026-10-15T12:00:00Z"};
 const steps=[],outputs=[],aiCalls=[],calls=[];
 global.fetch=async(url,opts={})=>{
  const u=new URL(String(url)),method=opts.method||"GET",payload=opts.body?JSON.parse(opts.body):null;
  calls.push({url:u.toString(),method,path:u.pathname,payload});
  let data=[],status=200;
  if(u.pathname==="/auth/v1/user")data={id:USER};
  else if(u.pathname.endsWith("/system_admins"))data=[{user_id:USER}];
  else if(u.pathname.endsWith("/regente10_missions")){
   if(method==="PATCH"){Object.assign(m,payload);data=[{...m}];}
   else data=[{...m}];
  }
  else if(u.pathname.endsWith("/regente10_controls"))data=[{owner_id:USER,emergency_stop:false,text_budget_paused:true}];
  else if(u.pathname.endsWith("/regente10_mission_files"))data=[];
  else if(u.pathname.endsWith("/regente10_orientation_steps")){
   if(method==="POST"){steps.push({...payload,confirmed_at:"2026-10-15T13:00:00Z"});data=[steps.at(-1)];}
   else data=steps.map(x=>({...x}));
  }
  else if(u.pathname.endsWith("/regente10_outputs")){
   if(method==="POST"){const obj={...payload,id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",status:"produzido"};outputs.push(obj);data=[{...obj}];}
   else if(method==="PATCH"){const found=outputs.find(x=>x.slot===Number(u.searchParams.get("slot").replace("eq.","")));
    if(found){Object.assign(found,payload);data=[{...found}];}}
   else data=outputs.map(x=>({...x}));
  }
  else if(u.pathname.endsWith("/regente10_ai_calls")){
   if(method==="PATCH"){data=null;}
   else data=aiCalls.map(x=>({...x}));
  }
  else if(u.pathname.endsWith("/rpc/regente10_reserve_ai_budget")){
   const id=String(aiCalls.length+1).padStart(12,"0"),job="33333333-3333-4333-8333-"+id;
   aiCalls.push({id:job,kind:payload.p_kind,slot:payload.p_slot,status:"reservado",created_at:"2026-10-15T13:00:00Z"});
   data=job;
  }
  else if(u.pathname.endsWith("/rpc/regente10_settle_ai_budget"))data={state:"not_metered_or_prebudget"};
  else if(u.hostname==="api.openai.com"){
   const sys=payload.messages?.[0]?.content||"";
   let answer;
   if(sys.includes("C01 Orientação"))answer=JSON.stringify({objetivo:"Relatório institucional fictício",coerencia:"coerente",criterios_essenciais:["Concluir resultado"],riscos:[],perguntas:[]});
   else if(sys.includes("C03 Compositor"))answer=JSON.stringify({prompt:"Elaborar somente resumo textual.",entregaveis:[{titulo:"Relatório Markdown",criterio:"Documento utilizável"}],riscos:[],autorizacoes_previstas:[],testes_sugeridos:[]});
   else if(sys.includes("C08 Auditor"))answer=JSON.stringify({parecer:"conforme",achados:[],bloqueios_criticos:[],recomendacoes:[]});
   else answer="# Relatório fictício\n\nResultado textual finalizado sem efeitos externos.";
   data={choices:[{message:{content:answer}}],usage:{prompt_tokens:180,completion_tokens:90}};
  }
  else throw Error("Unexpected synthetic provider or DB request: "+method+" "+u.toString());
  return new Response(data===null?"":JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
 };
 return {mission:()=>m,steps,outputs,aiCalls,calls};
}
test("Phase1→authorization→text result→accept→conclude persists whole cycle with budget paused",async()=>{
 const db=fixture();
 let check=await send(orient,"GET","");
 assert.equal(check.nextStep,0);
 for(let stage=0;stage<3;stage++){
  const r=await send(orient,"POST","",{id:MID,stage});
  assert.equal(r.step,stage);
  check=await send(orient,"GET","");
  assert.equal(check.steps.length,stage+1);
 }
 assert.equal(db.mission().status,"aguardando_autorizacao");
 assert.equal(db.mission().diagnostic.bloqueio_critico,false);
 assert.equal(db.mission().result_plan.length,1);
 const auth=await send(missionHandler,"POST","authorize",{id:MID});
 assert.equal(auth.mission.status,"em_execucao");
 assert.equal(auth.scope.includes("Somente geração textual"),true);
 const produced=await send(missionHandler,"POST","generate",{id:MID,slot:0});
 assert.equal(produced.output.status,"produzido");
 assert.match(produced.output.content,/Relatório fictício/);
 assert.equal(db.mission().status,"em_resultados");
 const accepted=await send(missionHandler,"POST","accept",{id:MID,slot:0});
 assert.equal(accepted.output.status,"aceito");
 const final=await send(missionHandler,"POST","conclude",{id:MID});
 assert.equal(final.mission.status,"concluida");
 assert.equal(db.outputs.length,1);
 assert.equal(db.aiCalls.length,4);
 assert.equal(db.calls.filter(x=>x.path==="/v1/chat/completions").length,4);
 const revisited=await send(missionHandler,"GET","detail");
 assert.equal(revisited.mission.status,"concluida");
 assert.equal(revisited.outputs[0].status,"aceito");
 assert(db.calls.every(x=>!x.url.includes("backend.composio.dev")&&!x.url.includes("api.github.com")));
});
