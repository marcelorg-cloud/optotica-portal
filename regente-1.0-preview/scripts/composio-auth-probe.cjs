"use strict";
// Diagnostic GET only. No sessions are created and response bodies are discarded.
async function authProbe({apiKey=process.env.COMPOSIO_API_KEY,fetcher=fetch}={}){
 if(!apiKey)return {httpStatus:null,transport:"not_configured"};
 const control=new AbortController(),timer=setTimeout(()=>control.abort(),8000);
 try{
  const r=await fetcher("https://backend.composio.dev/api/v3.1/auth/session/info",{method:"GET",redirect:"error",signal:control.signal,headers:{"x-api-key":apiKey,Accept:"application/json"}});
  const status=Number.isInteger(r.status)&&r.status>=100&&r.status<=599?r.status:null;
  await r.body?.cancel().catch(()=>{});
  return {httpStatus:status,transport:"response_received"};
 }catch{return {httpStatus:null,transport:"request_failed"};}
 finally{clearTimeout(timer)}
}
module.exports={authProbe};
