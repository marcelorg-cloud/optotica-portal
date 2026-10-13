"use strict";
// Diagnostic GET only. No sessions are created; only a redacted error summary is kept.
const {providerErrorSummary}=require("../lib/composio-readonly.js");
// getToolkits documents Project ApiKeyAuth; session-info documents UserApiKeyAuth.
const PROJECT_PROBE="https://backend.composio.dev/api/v3.1/toolkits?limit=1";
async function authProbe({apiKey=process.env.COMPOSIO_API_KEY,fetcher=fetch}={}){
 if(!apiKey)return {httpStatus:null,transport:"not_configured"};
 const control=new AbortController(),timer=setTimeout(()=>control.abort(),8000);
 try{
  const r=await fetcher(PROJECT_PROBE,{method:"GET",redirect:"error",signal:control.signal,headers:{"x-api-key":apiKey,Accept:"application/json"}});
  const status=Number.isInteger(r.status)&&r.status>=100&&r.status<=599?r.status:null;
  if(r.ok){await r.body?.cancel().catch(()=>{});return {endpoint:"v3.1/toolkits",httpStatus:status,transport:"response_received",accepted:true};}
  return {endpoint:"v3.1/toolkits",httpStatus:status,transport:"response_received",accepted:false,providerError:await providerErrorSummary(r,apiKey)};
 }catch{return {endpoint:"v3.1/toolkits",httpStatus:null,transport:"request_failed"};}
 finally{clearTimeout(timer)}
}
module.exports={authProbe};
