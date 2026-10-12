"use strict";
// Phase-1 BRL budgeting for new missions: Master = Maestro human account.
// Only prices from official GPT-4.1-mini public price snapshot; no third-party
// pricing or FX rate is invented. External tools remain disabled.
const SB=process.env.SUPABASE_URL,PK=process.env.SUPABASE_PUBLISHABLE_KEY;
const UUID=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const ok=(r,n,v)=>r.status(n).json(v);
const head=t=>({apikey:PK,Authorization:"Bearer "+t,"Content-Type":"application/json"});
async function db(t,path,opt={}){
 if(!SB||!PK)throw Object.assign(new Error("Banco indisponível."),{status:503});
 const x=await fetch(SB+"/rest/v1/"+path,{...opt,headers:{...head(t),...(opt.headers||{})}});
 let v=null;try{v=await x.json()}catch{}
 if(!x.ok)throw Object.assign(new Error("Operação recusada: "+String(v?.message||v?.hint||"recurso indisponível").slice(0,180)),{status:x.status});
 return v;
}
async function identity(req){
 const token=String(req.headers.authorization||"").match(/^Bearer ([-.\w]+)$/)?.[1];
 if(!token)throw Object.assign(new Error("Faça login como Master."),{status:401});
 const u=await fetch(SB+"/auth/v1/user",{headers:head(token)});
 if(!u.ok)throw Object.assign(new Error("Sessão expirada."),{status:401});
 const me=await u.json();
 if(!UUID.test(me?.id||""))throw Object.assign(new Error("Identidade inválida."),{status:401});
 const a=await db(token,"system_admins?select=user_id&active=eq.true&user_id=eq."+me.id+"&limit=1");
 if(!a?.length)throw Object.assign(new Error("Somente Maestro/Master."),{status:403});
 return {token,uid:me.id};
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");
 if(!["GET","POST"].includes(req.method))return ok(res,405,{error:"Método inválido."});
 if(req.method==="POST"&&req.headers.origin){
  let h="";try{h=new URL(req.headers.origin).host}catch{}
  if(h!==req.headers.host)return ok(res,403,{error:"Origem não autorizada."});
 }
 try{
  const {token,uid}=await identity(req);
  const id=String(req.method==="GET"?req.query?.missionId:req.body?.missionId);
  if(!UUID.test(id))return ok(res,400,{error:"Missão inválida."});
  const missions=await db(token,"regente10_missions?select=id,project,status,paused,budget_policy,envelope_approved_at,owner_id&id=eq."+id+"&owner_id=eq."+uid+"&limit=1");
  const m=missions?.[0];if(!m)return ok(res,404,{error:"Missão não localizada."});
  if(req.method==="GET"){
   const rows=await db(token,"regente10_mission_budgets?select=mission_id,currency,fx_brl_per_usd,fx_source,model,model_price_source,model_price_date,estimated_text_brl,estimated_other_brl,estimated_total_brl,margin_pct,cap_brl,reserved_brl,metered_brl,state,approved_at,updated_at&mission_id=eq."+id+"&owner_id=eq."+uid+"&limit=1");
   return ok(res,200,{budget:rows?.[0]||null,missionBudgetPolicy:m.budget_policy,
    pricing:{model:"gpt-4.1-mini",inputUsdPerMillion:0.4,outputUsdPerMillion:1.6,
    source:"https://developers.openai.com/api/docs/models/gpt-4.1-mini",
    verifiedAt:"2026-10-12",callUpperBound:12,fxSource:"assunção informada pelo Maestro"},
    limitations:"Custo textual calculado em cenário conservador. Outros instrumentos não conectados, sem preço verificado e sem autorização de gasto."});
  }
  const action=String(req.body?.action||"");
  if(!["draft","approve"].includes(action))return ok(res,400,{error:"Ação indisponível."});
  if(m.budget_policy!=="budget_v1")return ok(res,409,{error:"Esta é uma missão anterior à política de orçamento financeiro. A aprovação não será alterada retroativamente."});
  if(m.status!=="aguardando_autorizacao")return ok(res,409,{error:"Finalize o Afinamento antes de aprovar orçamento."});
  if(m.paused)return ok(res,423,{error:"Missão pausada."});
  let result;
  if(action==="draft"){
   const fx=Number(req.body?.fx),other=Number(req.body?.otherEstimate??0),margin=Number(req.body?.marginPct??50);
   if(!Number.isFinite(fx)||fx<1||fx>20||!Number.isFinite(other)||other<0||other>9999||!Number.isFinite(margin)||margin<0||margin>300)
    return ok(res,400,{error:"Informe câmbio USD→BRL (1–20), estimativa adicional (0–9999) e margem (0–300%)."});
   result=await db(token,"rpc/regente10_budget_submit",{method:"POST",body:JSON.stringify({
    p_mission_id:id,p_fx:fx,p_other_estimate:other,p_margin_pct:margin
   })});
  }else{
   if(req.body?.confirm!==true)return ok(res,400,{error:"Confirme explicitamente o teto previsto e aprovado."});
   result=await db(token,"rpc/regente10_budget_approve",{method:"POST",body:JSON.stringify({
    p_mission_id:id,p_confirm:true
   })});
  }
  return ok(res,200,{result,externalWritesEnabled:false,scope:"orçamento de IA textual novo; outros custos excluídos ou informados manualmente"});
 }catch(e){return ok(res,e.status||500,{error:e.status?e.message:"Não foi possível registrar o orçamento. Nenhuma operação financeira deve ser repetida sem consultar o estado."})}
};