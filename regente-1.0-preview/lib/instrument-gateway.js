"use strict";
const crypto=require("node:crypto"),{createProvider}=require("./composio-gateway.js");
const {error,PROJECTS,hash,argumentsSafe,validateArguments,encryptLink,decryptLink,assertToolLevel,assertDestination}=require("./gateway-contract.js");
function createGateway({fetcher=fetch,provider=createProvider({fetcher}),rpc:override}={}){
 async function rpc(op,p,token){
  if(!PROJECTS.includes(p.project))throw error("invalid_project",400);
  if(override)return override(op,p,token);
  const key=process.env.REGENTE_GATEWAY_KEY,sb=process.env.SUPABASE_URL,pk=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!key||!sb||!pk)throw error("gateway_not_configured",503);
  let r;try{r=await fetcher(sb+"/rest/v1/rpc/regente10_gateway",{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),headers:{apikey:pk,...(token?{Authorization:"Bearer "+token}:{}),"Content-Type":"application/json"},body:JSON.stringify({p_operation:op,p_payload:p,p_dispatch_key:key})})}catch{throw error("s00_unavailable",503)}
  const d=await r.json();if(!r.ok){const m=String(d.message||""),known=[[/Emergency stop/,"emergency_stop"],[/credential rejected/,"gateway_credential_rejected"],[/Master|Identity/,"master_required"],[/budget|Financial|monetary|mission cap/i,"financial_authorization_pending"],[/scope|project|Resource|resource|S00/i,"s00_scope_denied"],[/expired|exhausted|revoked/i,"grant_unavailable"],[/Stale/,"stale_connection"],[/Idempotency/,"idempotency_collision"]];throw error(known.find(([rx])=>rx.test(m))?.[1]||"s00_operation_rejected",409)}
  return d;
 }
 async function journal(project,operation,run){const e=await rpc("control",{project,operation,requestKey:crypto.randomUUID()});try{const result=await run();await rpc("control_result",{project,id:e.id,state:"completed",diagnostic:"verified_control_operation"});return result}catch(err){await rpc("control_result",{project,id:e.id,state:"failed",diagnostic:err.code||"control_unavailable"}).catch(()=>{});throw err;}}
 const state=project=>rpc("worker_state",{project});
 async function binding(project,bindingId){const s=await state(project),b=s.bindings.find(x=>x.id===bindingId);if(!b)throw error("connection_outside_project",404);return b;}
 async function prepare(project,bindingId,force=false){
  const r=await rpc("prepare_connection",{project,bindingId,force});if(r.reused)return {state:r.binding.status,reused:true};const b=r.binding;
  try{
   if(!force&&!b.no_auth&&provider.findExisting){const existing=await provider.findExisting(b);if(existing){await rpc("connection_result",{project,bindingId,attemptId:b.attempt_id,state:"pending",accountId:existing,diagnostic:"existing_same_project_account"});return await verify(project,bindingId);}}
   const prepared=await provider.prepare(b),{link,...out}=prepared;
   return await rpc("connection_result",{project,bindingId,attemptId:b.attempt_id,...out,...(link?{encryptedLink:encryptLink(link,b)}:{})});
  }catch(e){await rpc("connection_result",{project,bindingId,attemptId:b.attempt_id,state:e.code==="session_scope_unproven"?"blocked":"error",diagnostic:e.code||"connection_unavailable"}).catch(()=>{});return {state:"error",diagnostic:e.code||"connection_unavailable"};}
 }
 async function verify(project,bindingId){const b=await binding(project,bindingId),v=await journal(project,"connection.verify",()=>provider.verify(b));
  
  await rpc("verified",{project,bindingId,revision:b.revision,...v});return v;
 }
 async function discover(project,bindingId,query=""){const b=await binding(project,bindingId);if(!b.toolkit)throw error("toolkit_not_found");const d=await journal(project,"tools.discover",()=>provider.tools(b,query));await rpc("tools",{project,bindingId,tools:d.tools});return {count:d.tools.length,hasMore:d.hasMore,skipped:d.skipped};}
 async function bootstrap(project,{catalog,bindingIds}={}){
  const catalogData=catalog||await journal(project,"discover",()=>provider.catalog()),s=await state(project),counts={prepared:0,reused:0,unsupported:0,errors:0,catalogHasMore:catalogData.hasMore};
  const rows=s.bindings.filter(b=>!bindingIds||bindingIds.includes(b.id));let index=0;
  async function work(){while(index<rows.length){const b=rows[index++];try{
   const match=provider.matchToolkit(catalogData.items,b.service_name);
   await rpc("discovery",{project,bindingId:b.id,...(match||{toolkit:null,authSchemes:[],noAuth:false,managedOauth:false})});
   if(!match){counts.unsupported++;continue;}
   const r=await prepare(project,b.id);r.reused?counts.reused++:counts.prepared++;if(r.state==="error")counts.errors++;await discover(project,b.id).catch(()=>{counts.errors++;});
  }catch{counts.errors++;}}}
  await Promise.all(Array.from({length:Math.min(4,rows.length)},work));return counts;
 }
 async function status(project,token){const d=await rpc("status",{project},token);d.connections=d.connections.map(b=>{const {encrypted_link,...row}=b;row.configurationUrl="https://dashboard.composio.dev/";row.documentationUrl=b.toolkit?"https://docs.composio.dev/toolkits/"+encodeURIComponent(b.toolkit):null;
  if(encrypted_link&&new Date(b.link_expires_at)>new Date()&&b.status==="pending")try{row.connectUrl=decryptLink(encrypted_link,b)}catch{row.diagnostic="connect_link_unavailable";}
  return row;});return {...d,audit:{...require("./gateway-audit.js"),commit:process.env.VERCEL_GIT_COMMIT_SHA||null,deployment:process.env.VERCEL_URL?"https://"+process.env.VERCEL_URL:null},bridge:"composio",apiVersion:"v3.1",release:"operational-gateway-v1",resultPolicy:"provider_content_is_untrusted",financialPolicy:"reserved_and_committed_ceiling_not_invoice",physicalDm6:"planned_privileged_routes_blocked"};}
 async function approve(p,token){
  if(p.confirm!==true||p.costVerified!==true||p.confirmNonPersonal!==true||!["public","internal"].includes(p.dataClass)||typeof p.resourceDescription!=="string"||p.resourceDescription.trim().length<12||p.resourceDescription.length>500)throw error("explicit_scope_and_cost_required",400);
  if(!Number.isFinite(p.unitMaxBrl)||Math.abs(p.unitMaxBrl*10000-Math.round(p.unitMaxBrl*10000))>1e-7||p.unitMaxBrl<0||p.unitMaxBrl>10000||!Number.isInteger(p.maxCalls)||p.maxCalls<1||p.maxCalls>100||!Number.isInteger(p.ttlMinutes)||p.ttlMinutes<1||p.ttlMinutes>60||typeof p.priceSource!=="string"||p.priceSource.trim().length<8||p.priceSource.length>500)throw error("invalid_envelope",400);
  argumentsSafe({source:p.priceSource,resource:p.resourceDescription});argumentsSafe(p.arguments);assertDestination(p.arguments);const b=await binding(p.project,p.bindingId);
  const t=await journal(p.project,"tools.discover",()=>provider.tool(b,p.toolSlug,p.version));assertToolLevel(t);validateArguments(t.schema,p.arguments);
  await rpc("tools",{project:p.project,bindingId:b.id,tools:[t]});await verify(p.project,b.id);
  const argsHash=hash(p.arguments),sc=await rpc("scope",{project:p.project,bindingId:b.id,toolSlug:t.slug,version:t.version,argsHash,dataClass:p.dataClass,description:p.resourceDescription,confirmNonPersonal:true},token);
  const resource=await rpc("resource",{project:p.project,resourceAlias:sc.resourceAlias,operation:"instrument.execute"});
  return rpc("grant",{project:p.project,missionId:p.missionId,bindingId:b.id,resourceAlias:sc.resourceAlias,operation:"instrument.execute",toolSlug:t.slug,version:t.version,contractHash:t.contractHash,arguments:p.arguments,argsHash,resourceHash:hash(resource.chain),unitMaxBrl:p.unitMaxBrl,priceSource:p.priceSource,maxCalls:p.maxCalls,ttlMinutes:p.ttlMinutes,confirm:true,costVerified:true},token);
 }
 async function executeApproved({project,grantId,requestKey}){
  const receipt=await rpc("receipt",{project,grantId,requestKey});if(receipt.event)return {reused:true,eventId:receipt.event.id,state:receipt.event.state,result:receipt.event.result,logId:receipt.event.provider_log_id,untrusted:true};
  const {grant:g,binding:b}=await rpc("grant_private",{project,grantId});argumentsSafe(g.arguments);assertDestination(g.arguments);
  const t=await journal(project,"tools.discover",()=>provider.tool(b,g.tool_slug,g.tool_version));assertToolLevel(t);validateArguments(t.schema,g.arguments);
  const v=await verify(project,b.id);if(!["active","no_auth"].includes(v.state))throw error("connection_not_active");
  const resource=await rpc("resource",{project,resourceAlias:g.resource_alias,operation:g.operation});
  const claim=await rpc("claim",{project,grantId,requestKey,argsHash:hash(g.arguments),contractHash:t.contractHash,resourceHash:hash(resource.chain)});
  if(claim.reused)return {reused:true,eventId:claim.event.id,state:claim.event.state,result:claim.event.result,logId:claim.event.provider_log_id,untrusted:true};
  const eventId=claim.event.id;
  try{await rpc("arm",{project,eventId})}catch(e){await rpc("cancel",{project,eventId,diagnostic:"authorization_changed_before_dispatch"}).catch(()=>{});throw e;}
  let result;try{result=await provider.execute(claim.binding,claim.grant)}catch(e){result={state:"uncertain",diagnostic:e.code||"provider_outcome_uncertain",logId:null,result:null};}
  await rpc("complete",{project,eventId,...result});return {...result,eventId,reused:false,untrusted:true};
 }
 return {rpc,state,prepare,verify,discover,bootstrap,status,approve,executeApproved};
}
// This is the only instrument tool contract given to an agent. No provider URL,
// account selector, credentials, argument overrides, or natural-language execution.
const agentTool={type:"function",function:{name:"regente_execute_approved",description:"Executa somente um envelope S00 vigente, com argumentos e conta já aprovados pelo Master.",strict:true,parameters:{type:"object",additionalProperties:false,properties:{project:{type:"string",enum:PROJECTS},grantId:{type:"string",format:"uuid"},requestKey:{type:"string",format:"uuid"}},required:["project","grantId","requestKey"]}}};
module.exports={createGateway,agentTool};
