"use strict";
const {createHash}=require("node:crypto");
// Deterministic, non-authoritative simulator. It DOES NOT issue operation tokens,
// access provider credentials, or authorize external effects.
const POLICY="s00-simulation-v1";
const RANK={public:0,internal:1,personal:2,sensitive:3,secret:4};
const SCOPES=s=>Array.isArray(s)?s:[];
const includes=(scopes,project)=>SCOPES(scopes).includes("*")||SCOPES(scopes).includes(project);
const has=(a,x)=>Array.isArray(a)&&a.includes(x);
const norm=x=>typeof x==="string"?x:"";
function eligibleProject(project){return project?.status==="active"}
function resourceEligibility(projectId,resource,parents=[]){
 const issues=[];
 if(!resource){return {allowed:false,base:null,reasons:["recurso_desconhecido"]}}
 const chain=[...parents,resource];
 if(chain.some(x=>x.lifecycle!=="active"))issues.push("recurso_ou_ancestral_nao_ativo");
 const privateClass=chain.some(x=>RANK[x.data_class]===undefined||RANK[x.data_class]>RANK.internal);
 if(privateClass)issues.push("dados_pessoais_ou_sensiveis_sem_CE14");
 let base=null;
 if(resource.owner_kind==="project"&&resource.owner_project===projectId)base="propria";
 else if(resource.share_category==="institutional_common"&&resource.owner_kind==="institute"&&RANK[resource.data_class]<=RANK.internal)base="institucional";
 else if(resource.share_category==="shared"&&has(resource.shared_projects,projectId))base="compartilhamento";
 if(!base)issues.push("sem_base_de_acesso_E14b");
 for(const a of parents){
  const cross=a.owner_kind==="project"&&a.owner_project!==projectId;
  const personal=a.owner_kind==="person";
  if(cross||personal){
   // An exception under an exclusive/restricted account requires a separately
   // verified policy decision and provider ACL. Missing evidence fails closed.
   if(!resource.policy_decision_ref)issues.push("excecao_de_heranca_sem_decisao_verificada");
  }
 }
 return {allowed:issues.length===0,base,reasons:[...new Set(issues)]};
}
function evaluate(input){
 const {project,participant,resource,parents=[],mission,route,operation,emergency=false,approvedOps=[],requireEnvelope=true}=input;
 const reasons=[];
 if(!eligibleProject(project))reasons.push("projeto_nao_ativo");
 if(!mission||mission.project!==project?.id||mission.paused)reasons.push("missao_fora_do_escopo_ou_pausada");
 if(emergency)reasons.push("parada_de_emergencia");
 if(!participant||participant.lifecycle!=="active"||!includes(participant.project_scopes,project?.id))reasons.push("escopo_participante_E14a");
 const resourceCheck=resourceEligibility(project?.id,resource,parents);
 reasons.push(...resourceCheck.reasons);
 if(!resource||!has(resource.allowed_operations,operation))reasons.push("operacao_nao_permitida_no_recurso");
 if(!route||route.participant_id!==participant?.id||route.resource_alias!==resource?.alias||route.operation!==operation)reasons.push("rota_nao_equivalente");
 if(route&&(!includes(route.project_scopes,project?.id)||!["verified_read","configured"].includes(route.availability)))reasons.push("rota_nao_disponivel_ou_escopo");
 if(route&&route.write_enabled)reasons.push("escrita_externa_desabilitada");
 if(route&&route.data_class_max&&resource&&RANK[route.data_class_max]<RANK[resource.data_class])reasons.push("classe_de_dados_nao_admitida");
 if(route&&(!route.cost_known||route.unit_cost===null||route.unit_cost===undefined))reasons.push("custo_unitario_desconhecido");
 // The old pilot textual envelope has only text scope, and cannot grant external
 // read/write by implication. Approved ops cannot come from AI generated fields.
 if(requireEnvelope&&(!mission?.envelope_approved_at||!has(approvedOps,operation)))reasons.push("envelope_nao_autoriza_operacao");
 // No privileged provider executor exists yet, so simulation never creates a grant.
 return {policy:POLICY,scenario:reasons.length?"would_deny":"would_allow",reasons:[...new Set(reasons)],baseAccess:resourceCheck.base,operativeAuthorization:false,dispatched:false};
}
const profiles={
 optotica:[["A1","text.generate"],["A2","text.generate"],["F1","repo.metadata.read"],["F3","status.read"],["F4","image.standardize"]],
 ensavim:[["A3","text.generate"],["F6","design.create"],["F7","video.render"],["F9","post.publish"],["F12","status.read"],["F15","status.read"]],
 "born-robot":[["A1","text.generate"],["F1","repo.metadata.read"],["F2","status.read"],["F3","status.read"]],
 "instituto-governanca":[["A4","text.generate"],["F3","status.read"],["F12","status.read"],["F13","document.read"],["F14","sheet.read"],["F15","status.read"]]
};
function mapForMission(mission,projects,participants,resources,routes,checks=[]){
 const project=projects.find(x=>x.id===mission.project);
 const lines=(profiles[mission.project]||[]).map(([node,operation])=>{
  const participant=participants.find(x=>x.id===node);
  const candidates=routes.filter(x=>x.participant_id===node&&x.operation===operation).sort((a,b)=>a.id.localeCompare(b.id));
  const alternatives=candidates.map(route=>{
   const resource=resources.find(x=>x.alias===route.resource_alias);
   const parents=[];let cursor=resource, guard=0;
   while(cursor?.parent_alias&&guard++<8){cursor=resources.find(x=>x.alias===cursor.parent_alias);if(cursor)parents.unshift(cursor)}
   const check=checks.find(c=>c.node_id===node&&c.operation==="read");
   const evidenceRecent=check&&Number.isFinite(Date.parse(check.checked_at))&&(Date.now()-Date.parse(check.checked_at)<86_400_000)&&check.state==="pronto";
   const evalResult=evaluate({project,mission,participant,resource,parents,route,operation,approvedOps:[],requireEnvelope:false});
   const reasons=[...evalResult.reasons];
   if(!evidenceRecent)reasons.push("prontidao_sem_evidencia_vigente");
   if(!["verified_read","configured"].includes(route.availability))reasons.push("rota_nao_certificada_para_a_operacao");
   return {routeId:route.id,type:route.route_type,resourceAlias:route.resource_alias,availability:route.availability,effectiveProject:mission.project,eligible:reasons.length===0,reasons:[...new Set(reasons)],writeEnabled:false};
  });
  const chosen=alternatives.find(x=>x.eligible);
  return {linkId:node+"|"+operation,operator:node,operation,activeRoute:null,proposedRoute:chosen?.routeId||null,alternatives:alternatives.filter(x=>x.routeId!==chosen?.routeId),mode:"draft_only",status:chosen?"candidate_read_only":"sem_rota_verificada"};
 });
 const core={policy:POLICY,project:mission.project,missionId:mission.id,links:lines,externalWritingEnabled:false,requiresMaestroApproval:true};
 // Snapshot excludes timestamps; caller may include evidence stamps separately.
 const selectionHash=createHash("sha256").update(JSON.stringify(core)).digest("hex");
 return {...core,selectionHash,notes:"Mapa de Afinamento, não ativa rotas. Nenhuma publicação/commit/conta externa é autorizada."};
}
module.exports={POLICY,resourceEligibility,evaluate,mapForMission};
