"use strict";
const {randomUUID}=require("node:crypto");
const {BUCKET,MAX_BYTES,kind,UUID,personal}=require("../lib/phase1-files.js");
const SB=process.env.SUPABASE_URL,PK=process.env.SUPABASE_PUBLISHABLE_KEY;
const respond=(r,n,x)=>r.status(n).json(x);
const header=t=>({apikey:PK,Authorization:"Bearer "+t,"Content-Type":"application/json"});
async function db(token,path,opt={}){
 if(!SB||!PK)throw Object.assign(new Error("Armazenamento indisponível."),{status:503});
 const r=await fetch(SB+"/rest/v1/"+path,{...opt,headers:{...header(token),...(opt.headers||{})},redirect:"error",signal:AbortSignal.timeout(9000)});
 let x=null;try{x=await r.json()}catch{}
 if(!r.ok)throw Object.assign(new Error("Armazenamento recusou a operação: "+String(x?.message||r.status).slice(0,125)),{status:r.status});
 return x;
}
async function master(req){
 const t=String(req.headers.authorization||"").match(/^Bearer ([-.\w]+)$/)?.[1];
 if(!t)throw Object.assign(new Error("Faça login como Maestro/Master."),{status:401});
 const u=await fetch(SB+"/auth/v1/user",{headers:header(t),signal:AbortSignal.timeout(8000)});
 if(!u.ok)throw Object.assign(new Error("Sessão expirada."),{status:401});
 const me=await u.json();
 if(!UUID.test(me?.id||""))throw Object.assign(new Error("Identidade inválida."),{status:401});
 const a=await db(t,"system_admins?select=user_id&active=eq.true&user_id=eq."+me.id+"&limit=1");
 if(!Array.isArray(a)||a.length!==1)throw Object.assign(new Error("Somente Master ativo pode anexar arquivos."),{status:403});
 return {token:t,uid:me.id};
}
async function mission(t,uid,id){
 if(!UUID.test(id||""))throw Object.assign(new Error("Missão inválida."),{status:400});
 const rows=await db(t,"regente10_missions?select=id,project,status,paused,owner_id&id=eq."+id+"&owner_id=eq."+uid+"&limit=1");
 if(!rows?.length)throw Object.assign(new Error("Missão não localizada."),{status:404});
 return rows[0];
}
const pathUrl=path=>String(path).split("/").map(encodeURIComponent).join("/");
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","no-referrer");
 if(!["GET","POST"].includes(req.method))return respond(res,405,{error:"Método não permitido."});
 if(req.method==="POST"&&req.headers.origin){
  let originHost="";try{originHost=new URL(req.headers.origin).host}catch{}
  if(originHost!==req.headers.host)return respond(res,403,{error:"Origem não autorizada."});
 }
 try{
  const {token,uid}=await master(req);
  const params=req.method==="GET"?req.query:req.body||{};
  const m=await mission(token,uid,String(params.missionId||""));
  if(req.method==="GET"){
   const rows=await db(token,"regente10_mission_files?select=id,filename,mime,size_bytes,storage_path,include_in_ai,created_at&owner_id=eq."+uid+"&mission_id=eq."+m.id+"&order=created_at.asc&limit=6");
   return respond(res,200,{files:rows||[],bucket:BUCKET,maxBytes:MAX_BYTES,maxFiles:5,
    supportedForAi:["txt","md","csv","json","docx"],
    note:"PDFs e imagens são guardados como referências, mas não analisados automaticamente."});
  }
  const action=String(params.action||"");
  if(!["prepare","register","remove"].includes(action))return respond(res,400,{error:"Ação indisponível."});
  const flags=await db(token,"regente10_controls?select=emergency_stop&owner_id=eq."+uid+"&limit=1");
  if(flags?.[0]?.emergency_stop||m.paused)throw Object.assign(new Error("Missão ou Regente pausado."),{status:423});
  if(action==="prepare"){
   if(!["afinamento","aguardando_autorizacao"].includes(m.status))return respond(res,409,{error:"Arquivos devem ser anexados na Fase 1."});
   const fileName=String(params.fileName||"").trim(),size=Number(params.size);
   const type=kind(fileName,params.mime);
   if(!type||!Number.isInteger(size)||size<1||size>MAX_BYTES)return respond(res,400,{error:"Formato/tamanho inválido. Até 3 MB por arquivo; TXT, MD, CSV, JSON, DOCX, PDF, PNG ou JPG."});
   if(personal(fileName))return respond(res,400,{error:"Remova identificadores pessoais do nome do arquivo."});
   const rows=await db(token,"regente10_mission_files?select=id&mission_id=eq."+m.id+"&owner_id=eq."+uid+"&limit=6");
   if(rows?.length>=5)return respond(res,409,{error:"Limite de cinco anexos por missão."});
   const id=randomUUID(),storagePath=uid+"/"+m.id+"/"+id+"."+type.extension;
   return respond(res,200,{id,path:storagePath,bucket:BUCKET,mime:type.mime,
    canAnalyze:type.canAnalyze,maxBytes:MAX_BYTES,
    note:"Envie diretamente ao Storage privado com sua sessão Master; não compartilhe links públicos."});
  }
  if(action==="register"){
   if(!["afinamento","aguardando_autorizacao"].includes(m.status))return respond(res,409,{error:"Apenas arquivos da Fase 1 podem ser registrados."});
   const id=String(params.id||""),filename=String(params.fileName||"").trim(),storagePath=String(params.path||"");
   const type=kind(filename,params.mime),size=Number(params.size),includeInAi=params.includeInAi===true;
   if(!UUID.test(id)||!type||!Number.isInteger(size)||size<1||size>MAX_BYTES||params.acknowledgedNonPersonal!==true)
    return respond(res,400,{error:"Dados do arquivo inválidos ou confirmação de conteúdo institucional ausente."});
   if(personal(filename)||includeInAi&&!type.canAnalyze)return respond(res,400,{error:"Nome pessoal ou formato sem extração de texto validada."});
   if(storagePath!==uid+"/"+m.id+"/"+id+"."+type.extension)return respond(res,400,{error:"Arquivo fora da missão."});
   const a=await db(token,"regente10_mission_files",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
    id,owner_id:uid,mission_id:m.id,storage_path:storagePath,filename,mime:type.mime,
    size_bytes:size,include_in_ai:includeInAi,acknowledged_nonpersonal:true
   })});
   if(!a?.length)throw Object.assign(new Error("Falha ao registrar anexo privado."),{status:503});
   return respond(res,201,{file:{id:a[0].id,filename:a[0].filename,mime:a[0].mime,size_bytes:a[0].size_bytes,include_in_ai:a[0].include_in_ai},registered:true});
  }
  const id=String(params.id||"");
  if(!UUID.test(id))return respond(res,400,{error:"Arquivo inválido."});
  const rows=await db(token,"regente10_mission_files?select=id,storage_path&mission_id=eq."+m.id+"&owner_id=eq."+uid+"&id=eq."+id+"&limit=1");
  if(!rows?.length)return respond(res,404,{error:"Anexo não encontrado."});
  const url=SB+"/storage/v1/object/"+BUCKET+"/"+pathUrl(rows[0].storage_path);
  const drop=await fetch(url,{method:"DELETE",headers:header(token),redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!drop.ok)throw Object.assign(new Error("Storage não confirmou a remoção; arquivo preservado."),{status:503});
  await db(token,"regente10_mission_files?id=eq."+id+"&mission_id=eq."+m.id+"&owner_id=eq."+uid,{method:"DELETE",headers:{"Prefer":"return=minimal"}});
  return respond(res,200,{removed:true});
 }catch(e){return respond(res,e.status||503,{error:e.status?String(e.message):"Operação de anexo indisponível. Verifique o estado antes de repetir."})}
};