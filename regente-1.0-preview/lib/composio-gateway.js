"use strict";
const {error,normalizeTool,safeLink,sanitizeResult}=require("./gateway-contract.js");
const {providerErrorSummary}=require("./composio-readonly.js");
const BASE="https://backend.composio.dev/api/v3.1/",ID=/^[A-Za-z0-9_-]{1,150}$/;
function createProvider({fetcher=fetch,apiKey=process.env.COMPOSIO_API_KEY}={}){
 async function request(path,method="GET",body){
  if(!apiKey)throw error("composio_not_configured",503);
  try{
   const r=await fetcher(BASE+path,{method,redirect:"error",signal:AbortSignal.timeout(8000),headers:{"x-api-key":apiKey,Accept:"application/json",...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
   if(!r.ok){const summary=await providerErrorSummary(r,apiKey),e=error(r.status===401||r.status===403?"composio_scope_rejected":r.status===429?"provider_rate_limited":"provider_http_"+r.status,502);e.requestId=summary.requestId;throw e;}
   const reader=r.body.getReader(),chunks=[];let n=0;
   try{for(;;){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>6000000)throw error("provider_response_too_large",502);chunks.push(Buffer.from(value));}}finally{reader.cancel().catch(()=>{});}
   try{return JSON.parse(Buffer.concat(chunks).toString("utf8"))}catch{throw error("provider_invalid_json",502)}
  }catch(e){if(e.code&&e.status)throw e;throw error("provider_outcome_unavailable",504)}
 }
 async function pages(path,maxPages=5){let rows=[],cursor,hasMore=false;for(let i=0;i<maxPages;i++){
  const d=await request(path+(cursor?"&cursor="+encodeURIComponent(cursor):""));
  if(!Array.isArray(d.items)||d.items.length>1000)throw error("provider_invalid_catalog",502);
  rows.push(...d.items);cursor=typeof d.next_cursor==="string"?d.next_cursor:null;hasMore=Boolean(cursor);if(!cursor)break;
 }return {items:rows,hasMore};}
 const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,"");
 function matchToolkit(items,name){const n=norm(name),aliases={facebookads:["facebookads","facebookad"],windsor:["windsor","windsorai"],googlecalendar:["googlecalendar"]};
  const targets=aliases[n]||[n],matches=items.filter(t=>!t.deprecated?.is_deprecated&&!t.is_local_toolkit&&(targets.includes(norm(t.name))||targets.includes(norm(t.slug))));
  if(matches.length!==1)return null;const t=matches[0];if(!/^[a-z0-9_]{1,90}$/.test(t.slug))return null;
  const schemes=Array.isArray(t.auth_schemes)?t.auth_schemes.map(x=>String(x).toUpperCase()):[];
  return {toolkit:t.slug,authSchemes:schemes,noAuth:t.no_auth===true,managedOauth:Array.isArray(t.composio_managed_auth_schemes)&&t.composio_managed_auth_schemes.some(x=>/^OAUTH[12]$/i.test(x))};
 }
 async function prepare(b){
  if(b.no_auth)return {state:"no_auth",diagnostic:"no_auth_toolkit_verified"};
  if(!b.managed_oauth)return {state:b.auth_schemes?.some(x=>/API_KEY|BEARER_TOKEN|BASIC/.test(x))?"needs_credentials":"needs_config",diagnostic:"provider_configuration_required"};
  const body={user_id:b.provider_user_id,toolkits:{enable:[b.toolkit]},tools:{[b.toolkit]:{enable:[]}},instant:false,manage_connections:{enable:false,enable_wait_for_connections:false,enable_connection_removal:false},workbench:{enable:false},proxy_execute:{enable:false},multi_account:{enable:false},search:{enable:false},execute:{enable_multi_execute:false}};
  const s=await request("tool_router/session","POST",body),c=s.config;
  const bounded=ID.test(s.session_id||"")&&c?.user_id===b.provider_user_id&&c.instant===false&&c.workbench?.enable===false&&c.proxy_execute?.enable===false&&c.manage_connections?.enabled===false&&c.search?.enable===false&&c.execute?.enable_multi_execute===false&&Array.isArray(c.toolkits?.enabled)&&c.toolkits.enabled.length===1&&c.toolkits.enabled[0]===b.toolkit&&Array.isArray(c.tools?.[b.toolkit]?.enabled)&&c.tools[b.toolkit].enabled.length===0;
  if(!bounded){if(ID.test(s.session_id||""))try{await request("tool_router/session/"+s.session_id,"DELETE")}catch{}throw error("session_scope_unproven");}
  const callback="https://regente-1-0.vercel.app/oauth-return?project="+encodeURIComponent(b.project_id)+"&attempt="+b.attempt_id;
  const l=await request("tool_router/session/"+s.session_id+"/link","POST",{toolkit:b.toolkit,alias:"regente-"+b.project_id+"-"+b.service_key+"-"+b.revision,callback_url:callback});
  if(!ID.test(l.connected_account_id||"")||(l.experimental?.account_type&&l.experimental.account_type!=="PRIVATE"))throw error("connection_scope_unproven");
  return {state:"pending",sessionId:s.session_id,accountId:l.connected_account_id,link:safeLink(l.redirect_url),diagnostic:"human_consent_pending"};
 }
 async function verify(b){
  if(b.no_auth)return {state:"no_auth",diagnostic:"no_auth_toolkit_verified"};
  if(!ID.test(b.account_id||""))return {state:"expired",diagnostic:"connect_required"};
  const a=await request("connected_accounts/"+b.account_id);
  if(a.id!==b.account_id||a.user_id!==b.provider_user_id||a.toolkit?.slug!==b.toolkit||(a.experimental?.account_type&&a.experimental.account_type!=="PRIVATE"))return {state:"blocked",diagnostic:"account_project_identity_mismatch"};
  if(a.is_disabled===true||a.auth_config?.is_disabled===true)return {state:"blocked",diagnostic:"account_disabled"};
  if(a.status==="ACTIVE")return {state:"active",diagnostic:"identity_verified_not_resource_authorization"};
  if(["INITIALIZING","INITIATED"].includes(a.status))return {state:"pending",diagnostic:"human_consent_pending"};
  return {state:["EXPIRED","REVOKED","INACTIVE"].includes(a.status)?"expired":"error",diagnostic:"provider_account_"+String(a.status||"unknown").toLowerCase().replace(/[^a-z_]/g,"").slice(0,30)};
 }
 async function findExisting(b){
  const d=await pages("connected_accounts?account_type=PRIVATE&limit=100&user_ids="+encodeURIComponent(b.provider_user_id)+"&toolkit_slugs="+encodeURIComponent(b.toolkit),3);
  const matches=d.items.filter(a=>a.user_id===b.provider_user_id&&a.toolkit?.slug===b.toolkit&&a.status==="ACTIVE"&&a.is_disabled!==true&&a.auth_config?.is_disabled!==true&&(!a.experimental?.account_type||a.experimental.account_type==="PRIVATE")&&ID.test(a.id||""));
  if(d.hasMore||matches.length>1)throw error("multiple_accounts_require_selection");
  return matches.length===1?matches[0].id:null;
 }
 async function tools(b,query=""){const d=await pages("tools?toolkit_slug="+encodeURIComponent(b.toolkit)+"&include_pricing=true&include_deprecated=false&toolkit_versions=latest&limit=100"+(query?"&query="+encodeURIComponent(query):""),3);let skipped=0;const normalized=[];for(const t of d.items)try{normalized.push(normalizeTool(t,b.toolkit))}catch{skipped++;}return {tools:normalized,hasMore:d.hasMore,skipped};}
 async function tool(b,slug,version){if(!ID.test(slug)||!/^[\w.-]{1,80}$/.test(version)||version==="latest")throw error("explicit_tool_version_required");return normalizeTool(await request("tools/"+slug+"?version="+encodeURIComponent(version)+"&include_pricing=true"),b.toolkit);}
 async function execute(b,g){const d=await request("tools/execute/"+g.tool_slug,"POST",{version:g.tool_version,user_id:b.provider_user_id,...(!b.no_auth?{connected_account_id:b.account_id}:{}),arguments:g.arguments});
  const logId=typeof d.log_id==="string"&&/^[A-Za-z0-9_.:-]{5,150}$/.test(d.log_id)&&!d.log_id.includes(apiKey)?d.log_id:null;
  return {state:d.successful===true&&logId?"completed":"uncertain",logId,result:d.successful===true?sanitizeResult(d.data):null,diagnostic:d.successful===true?"provider_result":"provider_execution_uncertain"};
 }
 return {catalog:()=>pages("toolkits?type=native&include_deprecated=false&sort_by=alphabetically&limit=1000",5),matchToolkit,prepare,verify,findExisting,tools,tool,execute};
}
module.exports={createProvider};
