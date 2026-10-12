"use strict";
// Fixed project inventory only; no tools, OAuth, proxy, or sessions.
const BASE="https://backend.composio.dev/api/v3.1/";
const PATHS={configs:"auth_configs?limit=100&show_disabled=true",accounts:"connected_accounts?limit=100&account_type=PRIVATE"};
const fail=(message,status=502,code="provider_unavailable")=>Object.assign(new Error(message),{status,code,safeProviderError:true});
function identifier(value,key){const s=typeof value==="string"?value:"";return /^[a-zA-Z0-9_-]{1,120}$/.test(s)&&(!key||!s.includes(key))?s:null;}
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
   try{const raw=await readJson(r),id=identifier(raw?.error?.request_id,apiKey);if(id&&/^req_[a-zA-Z0-9_-]+$/.test(id))e.providerRequestId=id;}catch{}
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
module.exports={providerGet,inventory};
