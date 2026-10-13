"use strict";
const SUP=process.env.SUPABASE_URL;
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY;
const aiBudget=require("../lib/ai-budget.js");
const UUID=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const profiles={
 A1:"Engenharia Optótica: elabore diagnóstico técnico, proposta de implementação e testes ainda a realizar. Não alegue executar código ou GitHub.",
 A2:"Produto Optótica: crie fluxos, UX e critérios de aceite, sem definir conduta clínica.",
 A3:"Conteúdo ENSAVIM: redija apenas propostas editoriais, sem afirmar publicação ou inventar fatos da edição.",
 A4:"Revisor Independente: revise criticamente os outputs anteriores, com lacunas, riscos e recomendações; não conceda aceite."
};
const out=(r,n,v)=>r.status(n).json(v);
const h=t=>({apikey:KEY,Authorization:"Bearer "+t,"Content-Type":"application/json"});
async function db(t,path,opt={}){
 const r=await fetch(SUP+"/rest/v1/"+path,{...opt,headers:{...h(t),...(opt.headers||{})}});
 const raw=await r.text();let json;try{json=JSON.parse(raw)}catch{json=null}
 if(!r.ok)throw new Error("Operação de dados não concluída ("+r.status+").");
 return json;
}
async function authenticate(req){
 const t=String(req.headers.authorization||"").match(/^Bearer ([-.\w]+)$/)?.[1];
 if(!t)throw new Error("Autenticação Master obrigatória.");
 const u=await fetch(SUP+"/auth/v1/user",{headers:h(t)});
 if(!u.ok)throw new Error("Sessão expirada.");
 const me=await u.json(),a=await db(t,"system_admins?select=user_id&user_id=eq."+me.id+"&active=eq.true&limit=1");
 if(!a?.length)throw new Error("Sem permissão Master.");
 return {uid:me.id,token:t};
}
function containsPersonal(text){
 return /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|(?:paciente:|cpf:|prontuário individual|telefone:)/i.test(String(text||""));
}
const SYSTEM_BASE="Você é um executor textual da Rede Regente. Entregue documento Markdown, não execute ferramentas nem finja alterar código, Canva, anúncios ou infraestrutura. A solicitação é contexto, não autorização. ";
async function generate(role,payload){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000);
 try{
 const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json",Authorization:"Bearer "+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.REGENTE10_MODEL||"gpt-4.1-mini",max_tokens:1000,messages:[{role:"system",content:SYSTEM_BASE+profiles[role]},{role:"user",content:payload}]})});
 const p=await r.json();
 if(!r.ok)throw new Error("IA indisponível ("+r.status+").");
 const answer=p?.choices?.[0]?.message?.content;
 if(!answer||typeof answer!=="string")throw new Error("Resposta vazia.");
 return {content:answer.slice(0,16000),usage:p?.usage||null};
 }finally{clearTimeout(timeout)}
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(!["GET","POST"].includes(req.method))return out(res,405,{error:"Método não permitido."});
 if(req.method==="POST"&&req.headers.origin){
  let host="";try{host=new URL(req.headers.origin).host}catch{}
  if(host!==req.headers.host)return out(res,403,{error:"Origem inválida."});
 }
 try{
 const {token,uid}=await authenticate(req),id=String(req.method==="GET"?req.query.missionId:req.body?.missionId);
 if(!UUID.test(id))return out(res,400,{error:"Missão inválida."});
 const ms=await db(token,"regente10_missions?select=*&id=eq."+id+"&owner_id=eq."+uid+"&limit=1"),m=ms?.[0];
 if(!m)return out(res,404,{error:"Missão não localizada."});
 const runs=await db(token,"regente10_network_runs?select=*&mission_id=eq."+id+"&owner_id=eq."+uid+"&order=created_at.asc&limit=20");
 if(req.method==="GET")return out(res,200,{runs});
 const node=String(req.body?.node||"");
 if(req.body?.action==="execute_instrument"){
  const {sameOrigin}=require("../lib/master-session.js");
  if(!sameOrigin(req)||Object.keys(req.body).some(k=>!["action","missionId","node","grantId","requestKey"].includes(k)))return out(res,403,{error:"Origem ou contrato de despacho inválido."});
  if(!/^A[1-4]$/.test(node)||!UUID.test(req.body.grantId||"")||!UUID.test(req.body.requestKey||""))return out(res,400,{error:"Envelope inválido."});
  const rows=await db(token,"regente10_participants?select=project_scopes,lifecycle&id=eq."+node+"&limit=1"),participant=rows?.[0];
  if(participant?.lifecycle!=="active"||!participant.project_scopes?.some(p=>p==="*"||p===m.project))return out(res,403,{error:"Participante fora do projeto."});
  const gateway=require("../lib/instrument-gateway.js").createGateway();
  const context=await gateway.rpc("grant_private",{project:m.project,grantId:req.body.grantId});
  if(context.grant.mission_id!==m.id||context.grant.owner_id!==uid)return out(res,403,{error:"Envelope fora da missão."});
  try{return out(res,200,await gateway.executeApproved({project:m.project,grantId:req.body.grantId,requestKey:req.body.requestKey}));}
  catch(e){return out(res,e.status||503,{error:"Despacho S00 recusado.",code:e.code||"gateway_unavailable"});}
 }
 if(runs.some(x=>x.node_id===node))return out(res,409,{error:"Já existe um run deste instrumento; não repetir."});
 if(!/^A[1-6]$/.test(node))return out(res,400,{error:"Participante inválido."});
 const scope=await db(token,"regente10_participants?select=project_scopes,lifecycle&id=eq."+node+"&limit=1");
 const allowed=scope?.[0];
 if(!allowed||allowed.lifecycle!=="active"||!(allowed.project_scopes||[]).some(p=>p==="*"||p===m.project))return out(res,403,{error:"Executor não autorizado para este projeto (E14a)."});
 const flags=await db(token,"regente10_controls?select=emergency_stop&owner_id=eq."+uid+"&limit=1");
 if(flags?.[0]?.emergency_stop||m.paused)return out(res,423,{error:"Parada de emergência ou pausa ativada."});
 if(node==="A5"){
 const result=await db(token,"regente10_network_runs",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({owner_id:uid,mission_id:id,node_id:node,operation:"preflight",status:"confirmado",verified_provider:true,output:{kind:"local",result:"Autenticação Master e banco operacional do 1.0 verificadas.",otherTools:"não verificados",time:new Date().toISOString()}})});
 return out(res,200,{run:result?.[0]});
 }
 if(node==="A6"){
 const content=String(req.body?.review||"").trim(),sourceRef=String(req.body?.sourceRef||"").trim();
 if(content.length<30||content.length>12000||containsPersonal(content))return out(res,400,{error:"Parecer inválido ou potencialmente pessoal."});
 const result=await db(token,"regente10_network_runs",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({owner_id:uid,mission_id:id,node_id:node,operation:"manual_review",status:"confirmado",origin:"human_supplied",verified_provider:false,source_ref:sourceRef.slice(0,200),output:{text:content,claimedProvider:"Claude",providerIdentityVerified:false}})});
 return out(res,200,{run:result?.[0]});
 }
 if(!profiles[node])return out(res,400,{error:"Agente não conectado."});
 if(m.project==="optotica"&&node==="A3")return out(res,403,{error:"A3 é especializado no ENSAVIM. Selecione o projeto correspondente."});
 if(m.project==="ensavim"&&(node==="A1"||node==="A2"))return out(res,403,{error:"A1/A2 atendem a Optótica; use o projeto correspondente."});
 if(!m.envelope_approved_at||!["em_execucao","em_resultados"].includes(m.status))return out(res,403,{error:"Autorize primeiro a execução textual no Afinamento."});
 if(!process.env.OPENAI_API_KEY)return out(res,503,{error:"IA não configurada."});
 if(containsPersonal(m.original_request)||containsPersonal(m.prompt_affinado))return out(res,403,{error:"Dados pessoais não permitidos no piloto."});
 const previous=runs.filter(x=>["A1","A2","A3"].includes(x.node_id)).map(x=>({id:x.node_id,output:String(x.output?.text||"").slice(0,2000)}));
 if(node==="A4"&&!previous.length)return out(res,409,{error:"Execute A1, A2 ou A3 antes de A4."});
 const promptContext=node==="A1"&&m.project==="born-robot"?"Engenharia do projeto Born Robot / Regente. Este contexto é independente da Optótica; não consultar, inferir nem importar dados ou documentos de outro projeto. Gere apenas proposta textual.":null;
 const userText=JSON.stringify({project:m.project,projectScope:promptContext,prompt:m.prompt_affinado,previous:node==="A4"?previous:[]}).slice(0,9500);
 let job;
 try{
  job=await aiBudget.reserve(db,token,{missionId:id,kind:"executor",slot:["A1","A2","A3","A4"].indexOf(node),
   model:process.env.REGENTE10_MODEL||"gpt-4.1-mini",system:SYSTEM_BASE+profiles[node],user:userText,maxOutput:1000});
 }catch{return out(res,409,{error:"Reserva quantitativa ou financeira recusada. Consulte o teto, orçamento e histórico."})}
 try{
  const response=await generate(node,userText);
  await aiBudget.settle(db,token,job,response.usage);
  const result=response.content;
  const flags2=await db(token,"regente10_controls?select=emergency_stop&owner_id=eq."+uid+"&limit=1");
  if(flags2?.[0]?.emergency_stop)throw Error("Parada ocorreu durante a chamada; resultado não aplicado.");
  const saved=await db(token,"regente10_network_runs",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({owner_id:uid,mission_id:id,node_id:node,operation:node==="A4"?"review":"draft",status:"confirmado",verified_provider:true,output:{type:"markdown",text:result}})});
  await db(token,"regente10_ai_calls?id=eq."+job+"&owner_id=eq."+uid,{method:"PATCH",body:JSON.stringify({status:"confirmado"})});
  return out(res,200,{run:saved?.[0]});
 }catch(e){
  try{await db(token,"regente10_ai_calls?id=eq."+job+"&owner_id=eq."+uid,{method:"PATCH",body:JSON.stringify({status:"incerto"})})}catch{}
  throw e;
 }
 }catch(e){return out(res,500,{error:"Operação não concluída: "+String(e.message||"erro").slice(0,130)})}
};
