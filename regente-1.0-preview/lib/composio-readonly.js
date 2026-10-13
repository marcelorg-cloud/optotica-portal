"use strict";
// Fixed project inventory only; no tools, OAuth, proxy, or sessions.
const BASE="https://backend.composio.dev/api/v3.1/";
const PATHS={configs:"auth_configs?limit=100&show_disabled=true",accounts:"connected_accounts?limit=100&account_type=PRIVATE"};
const fail=(message,status=502,code="provider_unavailable")=>Object.assign(new Error(message),{status,code,safeProviderError:true});
function identifier(value,key){const s=typeof value==="string"?value:"";return /^[a-zA-Z0-9_-]{1,120}$/.test(s)&&(!key||!s.includes(key))?s:null;}
// True when any 8-character window of the key appears in text; such values are never logged.
function keyFragmentIn(text,key){if(typeof key!=="string"||!key)return false;if(text.includes(key))return true;for(let i=0;i+8<=key.length;i++)if(text.includes(key.slice(i,i+8)))return true;return false;}
// Composio documents request_id inside "error"; newer endpoints use camelCase. No prefix is documented.
function safeRequestId(value,key){const s=typeof value==="string"?value:"";return /^[A-Za-z0-9_.:-]{6,128}$/.test(s)&&!keyFragmentIn(s,key)?s:null;}
const safeToken=(v,key)=>Number.isInteger(v)?v:typeof v==="string"&&/^[A-Za-z0-9_.-]{1,64}$/.test(v)&&!keyFragmentIn(v,key)?v:null;
const MESSAGE_CLASSES=[["user_key_wrong_header",/user[ _-]?api[ _-]?key|x-user-api-key|\buak_/i],["org_key_wrong_header",/org(?:ani[sz]ation)?[ _-]?api[ _-]?key|x-org-api-key/i],["consumer_key_wrong_surface",/consumer[ _-]?(?:api[ _-]?)?key|\bck_/i],["missing_key",/missing|not provided|no api key|is required/i],["invalid_or_revoked_key",/invalid|not valid|revoked|expired|unknown|not found|incorrect/i]];
// Provider prose is classified into fixed labels, never copied into logs.
async function providerErrorSummary(r,key){
 const headerId=safeRequestId(r.headers?.get?.("x-request-id")||"",key);
 let raw=null;try{raw=await readJson(r)}catch{}
 const err=raw&&typeof raw.error==="object"&&raw.error?raw.error:raw||{};
 const message=typeof err.message==="string"?err.message:typeof raw?.message==="string"?raw.message:"";
 const found=MESSAGE_CLASSES.find(([,rx])=>rx.test(message));
 return {status:Number.isInteger(r.status)?r.status:null,code:safeToken(err.code,key),slug:safeToken(err.slug,key),
  requestId:safeRequestId(err.request_id,key)||safeRequestId(err.requestId,key)||safeRequestId(raw?.request_id,key)||safeRequestId(raw?.requestId,key)||headerId,
  messageClass:message?(found?found[0]:"other"):"absent",
  bodyShape:raw&&typeof raw==="object"&&!Array.isArray(raw)?Object.keys(raw).filter(k=>["error","message","detail","code","status","request_id","requestId"].includes(k)&&!keyFragmentIn(k,key)):[]};
}
async function readJson(r){
 const reader=r.body?.getReader();
 if(!reader)throw fail("Resposta Composio fora do contrato.",502,"invalid_response");
 const parts=[];let bytes=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1048576)throw fail("Resposta Composio excede o limite.",502,"invalid_response");parts.push(Buffer.from(value));}}finally{reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(parts).toString("utf8"))}catch{throw fail("Resposta Composio fora do contrato.",502,"invalid_response")}
}
async function providerGet(kind,{apiKey=process.env.COMPOSIO_API_KEY,fetcher=fetch,timeoutMs=8000}={}){
 if(!Object.hasOwn(PATHS,kind))throw fail("Consulta não permitida.",400,"invalid_query");
 if(!apiKey||!apiKey.trim())throw fail("Composio ainda não configurado no servidor.",503,"not_configured");
 const control=new AbortController(),timer=setTimeout(()=>control.abort(),timeoutMs);
 try{
  const r=await fetcher(BASE+PATHS[kind],{method:"GET",redirect:"error",signal:control.signal,headers:{"x-api-key":apiKey,Accept:"application/json"}});
  if(!r.ok){
   const e=fail(r.status===401||r.status===403?"O Composio recusou a credencial ou seu escopo.":"Consulta Composio indisponível.",502,r.status===401||r.status===403?"credential_rejected":"provider_unavailable");
   e.providerStatus=r.status;
   const summary=await providerErrorSummary(r,apiKey);
   if(summary.requestId)e.providerRequestId=summary.requestId;
   Object.defineProperty(e,"providerError",{value:summary,enumerable:false});
   throw e;
  }
  const data=await readJson(r);
  if(!data||!Array.isArray(data.items)||data.items.length>100)throw fail("Resposta Composio fora do contrato.",502,"invalid_response");
  const schemes=new Set(["OAUTH1","OAUTH2","API_KEY","BEARER_TOKEN","BASIC"]),statuses=new Set(["ACTIVE","INITIATED","INITIALIZING","INACTIVE","FAILED","EXPIRED","REVOKED","ENABLED","DISABLED"]);
  const items=data.items.map(row=>({
   id:identifier(row?.id,apiKey),toolkit:identifier(row?.toolkit?.slug,apiKey),status:statuses.has(row?.status)?row.status:"UNKNOWN",
   authScheme:schemes.has(row?.auth_scheme||row?.authScheme||row?.auth_config?.auth_scheme)?(row.auth_scheme||row.authScheme||row.auth_config.auth_scheme):"UNKNOWN",
   disabled:row?.is_disabled===true||row?.auth_config?.is_disabled===true||row?.status==="DISABLED",
   ...(kind==="configs"?{managed:row?.is_composio_managed===true}:{authConfigId:identifier(row?.auth_config?.id,apiKey),operationallyAuthorized:false})
  }));
  return {items,hasMore:Boolean(data.next_cursor)};
 }catch(e){if(e.safeProviderError===true)throw e;throw fail("Não foi possível consultar o Composio no prazo esperado.",504,"provider_unavailable");}finally{clearTimeout(timer)}
}
async function inventory(options={}){
 const [configs,accounts]=await Promise.all([providerGet("configs",options),providerGet("accounts",options)]);
 return {provider:"composio",projectLabel:"Regente1",apiVersion:"v3.1",credentialAccepted:true,checkedAt:new Date().toISOString(),configs:configs.items,accounts:accounts.items,
  hasMore:configs.hasMore||accounts.hasMore,accountScope:"project_private_inventory",activeAccounts:accounts.items.filter(x=>x.status==="ACTIVE"&&!x.disabled).length,
  externalWritesEnabled:false,toolExecutionEnabled:false,
  limitations:"Inventário do projeto associado à chave. Não certifica o nome remoto do projeto, acesso aos recursos, orçamento ou autorização por missão. Contas compartilhadas não são consultadas. Não cria conexões nem executa ferramentas."};
}
module.exports={providerGet,inventory,providerErrorSummary};
