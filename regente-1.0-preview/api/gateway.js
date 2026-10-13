"use strict";
const {cookieToken,verifyMaster,sameOrigin,noStore}=require("../lib/master-session.js");
const {createGateway}=require("../lib/instrument-gateway.js"),{PROJECTS,UUID,error}=require("../lib/gateway-contract.js");
const FIELDS={bootstrap:[],prepare:["bindingId"],reconnect:["bindingId"],verify:["bindingId","attemptId"],discover:["bindingId","query"],cap:["capBrl","fx","confirm"],approve:["missionId","bindingId","toolSlug","version","arguments","unitMaxBrl","maxCalls","ttlMinutes","priceSource","costVerified","confirm","confirmNonPersonal","dataClass","resourceDescription"],revoke:["grantId"],execute:["grantId","requestKey"]};
module.exports=async(req,res)=>{
 noStore(res);if(!["GET","POST"].includes(req.method))return res.status(405).json({error:"Método não permitido."});
 if(req.method==="POST"&&!sameOrigin(req))return res.status(403).json({error:"Origem não autorizada.",code:"invalid_origin"});
 try{
  const token=cookieToken(req);await verifyMaster(token);const gateway=createGateway(),p=req.method==="GET"?req.query:req.body;
  if(!p||typeof p!=="object"||Array.isArray(p)||!PROJECTS.includes(p.project))throw error("invalid_project",400);
  const action=p.action||"status";
  if(req.method==="GET"){
   if(!["status","tools","resources"].includes(action)||Object.keys(p).some(k=>!["project","action","bindingId"].includes(k)))throw error("invalid_query",400);
   if(action==="tools"&&!UUID.test(p.bindingId||""))throw error("invalid_connection",400);
   const d=action==="status"?await gateway.status(p.project,token):await gateway.rpc(action==="tools"?"tool_list":"resources",{project:p.project,...(p.bindingId?{bindingId:p.bindingId}:{})},token);
   return res.status(200).json(d);
  }
  if(!Object.hasOwn(FIELDS,action)||Object.keys(p).some(k=>!["project","action",...FIELDS[action]].includes(k)))throw error("invalid_action",400);
  for(const key of ["bindingId","grantId","missionId","requestKey","attemptId"])if(p[key]!==undefined&&!UUID.test(p[key]))throw error("invalid_identifier",400);
  let d;
  if(action==="bootstrap"){
   const s=await gateway.state(p.project),ids=s.bindings.filter(b=>["planned","discovered","unsupported","error","expired"].includes(b.status)).slice(0,4).map(b=>b.id);
   d=ids.length?await gateway.bootstrap(p.project,{bindingIds:ids}):{reused:s.bindings.length,prepared:0};
  }else if(["prepare","reconnect"].includes(action))d=await gateway.prepare(p.project,p.bindingId,action==="reconnect");
  else if(action==="verify"){
   if(p.attemptId){const s=await gateway.state(p.project),b=s.bindings.find(b=>b.id===p.bindingId&&b.attempt_id===p.attemptId);if(!b)throw error("stale_callback",409);}
   d=await gateway.verify(p.project,p.bindingId);
  }else if(action==="discover"){if(p.query!==undefined&&(typeof p.query!=="string"||p.query.length>100))throw error("invalid_query",400);d=await gateway.discover(p.project,p.bindingId,p.query||"");}
  else if(action==="cap"){
   if(p.confirm!==true||!Number.isFinite(p.capBrl)||!Number.isFinite(p.fx)||[p.capBrl,p.fx].some(n=>Math.abs(n*10000-Math.round(n*10000))>1e-7))throw error("explicit_financial_cap_required",400);
   d=await gateway.rpc("cap",p,token);
  }else if(action==="approve")d=await gateway.approve(p,token);
  else if(action==="revoke")d=await gateway.rpc("revoke",p,token);
  else d=await gateway.executeApproved(p);
  return res.status(200).json(d);
 }catch(e){return res.status(e.status||503).json({error:e.status===401||e.status===403?e.message:"Operação bloqueada ou indisponível. Consulte o diagnóstico S00.",code:e.code||"gateway_unavailable"});}
};
