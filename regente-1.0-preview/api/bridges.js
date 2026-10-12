"use strict";
// Bridge of read-only requests for ChatGPT connected hubs.
// This function cannot access ChatGPT plugins. A separate trusted operator must fulfill requests.
const SB=process.env.SUPABASE_URL||"https://xepkdqcbjrictowriccb.supabase.co";
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||"sb_publishable_F-DN3Z4GZbX5j2IeXtq5cw_rJHP6mfw";
const TOOLS=new Set(["github","vercel","supabase","canva","heygen","google_drive","windsor_meta"]);
const reply=(r,n,v)=>r.status(n).json(v),headers=t=>({apikey:KEY,Authorization:"Bearer "+t,"Content-Type":"application/json"});
async function read(token,path,opt={}){
 const r=await fetch(SB+"/rest/v1/"+path,{...opt,headers:{...headers(token),...(opt.headers||{})}});
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=null}
 if(!r.ok){const e=new Error("Banco recusou operação ("+r.status+").");e.status=r.status;throw e}
 return data;
}
async function auth(req){
 const token=String(req.headers.authorization||"").match(/^Bearer ([-.\w]+)$/)?.[1];
 if(!token)throw Object.assign(new Error("Entre com a sessão Master."),{status:401});
 const r=await fetch(SB+"/auth/v1/user",{headers:headers(token)});
 if(!r.ok)throw Object.assign(new Error("Sessão inválida."),{status:401});
 const u=await r.json();
 if(!u?.id)throw Object.assign(new Error("Identidade inválida."),{status:401});
 const a=await read(token,"system_admins?select=user_id&user_id=eq."+u.id+"&active=eq.true&limit=1");
 if(!a?.length)throw Object.assign(new Error("Acesso Master necessário."),{status:403});
 return {token,uid:u.id};
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(!["GET","POST"].includes(req.method))return reply(res,405,{error:"Método inválido."});
 if(req.method==="POST"&&req.headers.origin){
  let host="";try{host=new URL(req.headers.origin).host}catch{}
  if(host!==req.headers.host)return reply(res,403,{error:"Origem inválida."});
 }
 try{
  const {token,uid}=await auth(req);
  const path="regente10_hub_bridge_requests";
  if(req.method==="GET"){
   const recent=await read(token,path+"?select=id,bridge_id,operation,status,result,result_source,verified_at,created_at&owner_id=eq."+uid+"&order=created_at.desc&limit=40");
   return reply(res,200,{requests:recent||[],bridgeMode:"ChatGPT connector mediated; no unattended runtime access or credentials",capabilities:[...TOOLS],operations:["status_read","capabilities_read"],writeAvailable:false});
  }
  const bridge=String(req.body?.bridge||""),operation=String(req.body?.operation||"");
  if(!TOOLS.has(bridge)||!["status_read","capabilities_read"].includes(operation))return reply(res,400,{error:"Ponte ou operação não autorizada."});
  const controls=await read(token,"regente10_controls?select=emergency_stop&owner_id=eq."+uid+"&limit=1");
  if(controls?.[0]?.emergency_stop)return reply(res,423,{error:"Parada de emergência ativa."});
  const recent=await read(token,path+"?select=id,bridge_id,status&owner_id=eq."+uid+"&status=in.(pending,running)&limit=30");
  if(recent?.length>=20)return reply(res,429,{error:"Muitas verificações pendentes."});
  if(recent?.some(x=>x.bridge_id===bridge))return reply(res,409,{error:"Já existe uma verificação pendente para esse hub."});
  const saved=await read(token,path,{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({owner_id:uid,bridge_id:bridge,operation,status:"pending"})});
  if(!saved?.[0]?.id)throw Error("Solicitação não persistida.");
  return reply(res,201,{request:{id:saved[0].id,bridge_id:bridge,operation,status:"pending"},note:"Pendente. A solicitação não executa o conector por si só; o operador do hub precisa atendê-la."});
 }catch(e){return reply(res,e.status||500,{error:e.status?e.message:"Não foi possível concluir a ponte."})}
};