"use strict";
const {evaluate,mapForMission,POLICY}=require("../lib/s00-policy.js");
// Read-only institutional registry, draft map generation, and authorization SIMULATOR.
// The simulator is NOT an authoritative S00 execution grant and has no secrets.
const SB=process.env.SUPABASE_URL;
const PK=process.env.SUPABASE_PUBLISHABLE_KEY;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const send=(r,n,v)=>r.status(n).json(v);
function headers(t){return {apikey:PK,Authorization:"Bearer "+t,"Content-Type":"application/json"}}
async function db(token,path,opt={}){
 if(!SB||!PK)throw Object.assign(new Error("Supabase sem configuração no runtime."),{status:503});
 const response=await fetch(SB+"/rest/v1/"+path,{...opt,headers:{...headers(token),...(opt.headers||{})}});
 let content=null;try{content=await response.json()}catch{}
 if(!response.ok)throw Object.assign(new Error("Dados indisponíveis: "+String(content?.message||response.status).slice(0,125)),{status:response.status});
 return content;
}
async function auth(req){
 const token=String(req.headers.authorization||"").match(/^Bearer ([-.\w]+)$/)?.[1];
 if(!token)throw Object.assign(new Error("Sessão Master necessária."),{status:401});
 const u=await fetch(SB+"/auth/v1/user",{headers:headers(token)});
 if(!u.ok)throw Object.assign(new Error("Sessão expirada."),{status:401});
 const user=await u.json();
 if(!UUID.test(user?.id||""))throw Object.assign(new Error("Identidade inválida."),{status:401});
 const allowed=await db(token,"system_admins?select=user_id&user_id=eq."+user.id+"&active=eq.true&limit=1");
 if(!Array.isArray(allowed)||allowed.length!==1)throw Object.assign(new Error("Somente Master autorizado."),{status:403});
 return {uid:user.id,token};
}
async function mission(token,uid,id){
 if(!UUID.test(String(id||"")))throw Object.assign(new Error("Missão inválida."),{status:400});
 const rows=await db(token,"regente10_missions?select=id,owner_id,project,status,title,paused,envelope_approved_at&owner_id=eq."+uid+"&id=eq."+id+"&limit=1");
 if(!rows?.length)throw Object.assign(new Error("Missão indisponível."),{status:404});
 return rows[0];
}
async function catalog(token){
 const [projects,participants,resources,routes,checks,relations,contracts]=await Promise.all([
 db(token,"regente10_projects?select=id,label,status,scope&order=id"),
 db(token,"regente10_participants?select=id,name,kind,project_scopes,lifecycle,notes&order=id"),
 db(token,"regente10_resources?select=alias,resource_kind,parent_alias,owner_kind,owner_project,share_category,data_class,shared_projects,allowed_operations,lifecycle,policy_decision_ref,policy_version,description&order=alias"),
 db(token,"regente10_routes?select=id,participant_id,resource_alias,operation,route_type,availability,project_scopes,data_class_max,failure_domains,cost_known,unit_cost,write_enabled,notes&order=id"),
 db(token,"regente10_adapter_checks?select=node_id,operation,state,checked_at&order=checked_at.desc&limit=50"),
 db(token,"regente10_relation_edges?select=source_id,target_id,status,relation_kind&order=source_id.asc&limit=200"),
 db(token,"regente10_capability_contracts?select=id,version,supplier_project,consumer_projects,resource_alias,operations,max_data_class,status,consumer_pays,rate_known,notes&order=id")
 ]);
 return {projects,participants,resources,routes,checks,relations,contracts};
}
async function assertNotStopped(token,uid){
 const controls=await db(token,"regente10_controls?select=emergency_stop&owner_id=eq."+uid+"&limit=1");
 if(controls?.[0]?.emergency_stop)throw Object.assign(new Error("Parada de emergência ativada."),{status:423});
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("Referrer-Policy","no-referrer");
 const action=String(req.query?.action||req.body?.action||"catalog");
 if(!["GET","POST"].includes(req.method))return send(res,405,{error:"Método inválido."});
 if(req.method==="POST"&&req.headers.origin){
  let host="";try{host=new URL(req.headers.origin).host}catch{}
  if(host!==req.headers.host)return send(res,403,{error:"Origem inválida."});
 }
 try{
  const {token,uid}=await auth(req);
  if(req.method==="GET"&&action==="catalog"){
   return send(res,200,{...(await catalog(token)),policy:POLICY,mode:"master_read_only_catalog",externalWritesEnabled:false});
  }
  if(req.method==="GET"&&action==="map"){
   const m=await mission(token,uid,req.query?.missionId);
   const maps=await db(token,"regente10_mission_connection_maps?select=state,selection,policy_version,updated_at&mission_id=eq."+m.id+"&owner_id=eq."+uid+"&limit=1");
   return send(res,200,{project:m.project,map:maps?.[0]||null,operationalApproval:false});
  }
  if(req.method==="GET"&&action==="history"){
   const m=await mission(token,uid,req.query?.missionId);
   const records=await db(token,"regente10_s00_simulations?select=participant_id,resource_alias,operation,outcome,reasons,policy_version,created_at&mission_id=eq."+m.id+"&owner_id=eq."+uid+"&order=created_at.desc&limit=25");
   return send(res,200,{simulations:records||[],operativeAuthorizations:0});
  }
  if(req.method!=="POST")return send(res,405,{error:"Método não permitido."});
  if(!["prepare_map","simulate"].includes(action))return send(res,400,{error:"Operação não disponível."});
  await assertNotStopped(token,uid);
  const m=await mission(token,uid,req.body?.missionId);
  const c=await catalog(token);
  if(action==="prepare_map"){
   const map=mapForMission(m,c.projects,c.participants,c.resources,c.routes,c.checks);
   const saved=await db(token,"regente10_mission_connection_maps?on_conflict=mission_id",{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=representation"},body:JSON.stringify({mission_id:m.id,owner_id:uid,project_id:m.project,state:"draft",selection:map,policy_version:POLICY,updated_at:new Date().toISOString()})});
   return send(res,200,{map:saved?.[0]?.selection||map,state:"draft",operativeAuthorization:false});
  }
  const node=String(req.body?.participantId||"").slice(0,8),alias=String(req.body?.resourceAlias||"").slice(0,90),operation=String(req.body?.operation||"").slice(0,90);
  const p=c.participants.find(x=>x.id===node),resource=c.resources.find(x=>x.alias===alias),project=c.projects.find(x=>x.id===m.project);
  if(!p||!resource||!operation)return send(res,400,{error:"Participante, recurso ou operação inválidos."});
  const routes=c.routes.filter(x=>x.participant_id===node&&x.resource_alias===alias&&x.operation===operation);
  const route=routes.find(x=>x.id===req.body.routeId)||null;
  let ancestor=resource,parents=[],limit=0;
  while(ancestor?.parent_alias&&limit++<8){
   ancestor=c.resources.find(x=>x.alias===ancestor.parent_alias);
   if(ancestor)parents.unshift(ancestor);
  }
  const env=m.envelope_approved_at?["text.generate"]:[];
  const evalResult=evaluate({project,mission:m,participant:p,resource,parents,route,operation,approvedOps:env,emergency:false});
  const record=await db(token,"regente10_s00_simulations",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({owner_id:uid,mission_id:m.id,participant_id:p.id,resource_alias:resource.alias,operation,outcome:evalResult.scenario,reasons:evalResult.reasons,policy_version:POLICY})});
  if(!record?.length)throw Object.assign(new Error("Simulação não registrada."),{status:503});
  return send(res,200,{...evalResult,routeId:route?.id||null,recorded:true,warning:"SIMULAÇÃO. Nenhuma permissão ou execução concedida."});
 }catch(e){return send(res,e.status||500,{error:e.status?String(e.message):"Operação não concluída. Consulte o estado antes de repetir."})}
};