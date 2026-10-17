"use strict";
const NETWORK_CATALOG=require("../network-catalog.json");
const API=process.env.SUPABASE_URL||"https://xepkdqcbjrictowriccb.supabase.co";
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||"sb_publishable_F-DN3Z4GZbX5j2IeXtq5cw_rJHP6mfw";
const ok=(res,status,data)=>res.status(status).json(data);
const hdr=t=>({apikey:KEY,Authorization:"Bearer "+t,"Content-Type":"application/json"});
async function db(t,path,opt={}){
 const r=await fetch(API+"/rest/v1/"+path,{...opt,headers:{...hdr(t),...(opt.headers||{})}});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=null}
 if(!r.ok)throw Error("Consulta indisponível ("+r.status+")");
 return data;
}
async function master(req){
 const token=String(req.headers.authorization||"").match(/^Bearer ([-.\w]+)$/)?.[1];
 if(!token)throw Error("Sessão necessária.");
 const u=await fetch(API+"/auth/v1/user",{headers:hdr(token)});
 if(!u.ok)throw Error("Sessão expirada.");
 const me=await u.json();
 const adm=await db(token,"system_admins?select=user_id&user_id=eq."+me.id+"&active=eq.true&limit=1");
 if(!adm?.length)throw Error("Acesso Master necessário.");
 return {token,uid:me.id};
}
const IDS=new Set(Array.from({length:15},(_,i)=>"F"+(i+1)));
async function probe(id,t){
 if(id==="F3"){
  await db(t,"regente10_controls?select=owner_id&limit=1");
  return {state:"pronto",detail:"Consulta autenticada à própria configuração do Regente 1.0."};
 }
 if(id==="F1"||id==="F2"){
  const url=id==="F1"?"https://api.github.com/repos/marcelorg-cloud/optotica-portal":"https://regente-1-0.vercel.app/api/mission?action=health";
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  try{
   const r=await fetch(url,{signal:controller.signal,redirect:"error",headers:{Accept:"application/json","User-Agent":"Regente-Readiness/1.0"}});
   if(!r.ok)return {state:"desconhecido",detail:"HTTP "+r.status};
   const data=await r.json();
   const verified=id==="F1"?data.full_name==="marcelorg-cloud/optotica-portal":data.service==="regente10";
   return {state:verified?"pronto":"desconhecido",detail:verified?"Consulta de leitura verificada; nenhuma escrita autorizada.":"Resposta não corresponde ao contrato esperado."};
  }finally{clearTimeout(timer)}
 }
 return {state:"desconhecido",detail:"Ferramenta documentada, mas nenhum adapter próprio do Regente 1.0 foi verificado."};
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(!["GET","POST"].includes(req.method))return ok(res,405,{error:"Método inválido."});
 if(req.method==="POST"&&req.headers.origin){
  let host="";try{host=new URL(req.headers.origin).host}catch{}
  if(host!==req.headers.host)return ok(res,403,{error:"Origem não permitida."});
 }
 try{
  const {token,uid}=await master(req);
  if(req.method==="GET"){
   const report=await db(token,"regente10_adapter_checks?select=node_id,operation,state,evidence,checked_at&owner_id=eq."+uid+"&order=checked_at.desc&limit=30");
   return ok(res,200,{checks:report,catalog:NETWORK_CATALOG,roleStatus:{A1:"configured_text_only",A2:"configured_text_only",A3:"configured_text_only",A4:"configured_text_only",A5:"local",A6:"manual"},scope:"Regente 1.0; nenhum instrumento externo habilitado para escrita"});
  }
  const id=String(req.body?.node||"");
  if(!IDS.has(id))return ok(res,400,{error:"Instrumento inválido."});
  const emergency=await db(token,"regente10_controls?select=emergency_stop&owner_id=eq."+uid+"&limit=1");
  if(emergency?.[0]?.emergency_stop)return ok(res,423,{error:"Parada de emergência ativa."});
  const result=await probe(id,token);
  const record={owner_id:uid,node_id:id,operation:"read",state:result.state,evidence:{detail:result.detail,writeAuthorized:false},checked_at:new Date().toISOString()};
  await db(token,"regente10_adapter_checks?on_conflict=owner_id,node_id,operation",{method:"POST",headers:{"Prefer":"resolution=merge-duplicates"},body:JSON.stringify(record)});
  return ok(res,200,{node:id,...result,checked_at:record.checked_at,writeAuthorized:false});
 }catch(e){return ok(res,403,{error:String(e.message||"Falha de verificação").slice(0,150)})}
};
