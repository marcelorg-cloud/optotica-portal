"use strict";
// Conservative per-operation textual token budget. Only GPT-4.1-mini tariff
// snapshot is approved; cost is an estimate derived from reported usage,
// NOT a provider invoice. Hard admissions use an atomic PostgreSQL RPC.
const MODEL="gpt-4.1-mini";
function inputBytes(system,user){
 return Buffer.byteLength(String(system||""),"utf8")+Buffer.byteLength(String(user||""),"utf8");
}
async function reserve(fetcher,token,{missionId,kind,slot,model=MODEL,system,user,maxOutput}){
 const amount=inputBytes(system,user);
 if(amount<1||amount>100000)throw Object.assign(new Error("Entrada de IA fora dos limites financeiros conhecidos."),{status:400});
 const value=await fetcher(token,"rpc/regente10_reserve_ai_budget",{method:"POST",body:JSON.stringify({
  p_mission_id:missionId,p_kind:kind,p_slot:slot,p_model:model,p_input_bytes:amount,p_max_output:maxOutput
 })});
 if(!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(String(value||"")))
  throw new Error("Reserva monetária/quantitativa não confirmada. Nenhuma IA foi acionada.");
 return value;
}
async function settle(fetcher,token,job,usage){
 const p=Number.isInteger(usage?.prompt_tokens)?usage.prompt_tokens:null;
 const out=Number.isInteger(usage?.completion_tokens)?usage.completion_tokens:null;
 const cached=Number.isInteger(usage?.prompt_tokens_details?.cached_tokens)?usage.prompt_tokens_details.cached_tokens:0;
 return fetcher(token,"rpc/regente10_settle_ai_budget",{method:"POST",body:JSON.stringify({
  p_job_id:job,p_input_tokens:p,p_cached_tokens:p===null?null:cached,p_output_tokens:out
 })});
}
module.exports={MODEL,inputBytes,reserve,settle};