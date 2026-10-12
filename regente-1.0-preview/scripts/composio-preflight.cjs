"use strict";
// Build-time read-only credential check; provider payloads never printed.
const {providerGet}=require("../lib/composio-readonly.js");
const {authProbe}=require("./composio-auth-probe.cjs");
async function main(){
 if(!process.env.COMPOSIO_API_KEY){console.log("COMPOSIO_PREFLIGHT not_configured; integration remains disabled");return;}
 const key=process.env.COMPOSIO_API_KEY;
 console.log("COMPOSIO_PREFLIGHT input_checks "+JSON.stringify({present:true,outerWhitespace:key!==key.trim(),quoted:/^[\"']|[\"']$/.test(key),masked:key.includes("**"),differentKeyKind:/^(uak_|ck_)/.test(key)}));
 try{await providerGet("configs");}catch(e){
  if(e.safeProviderError===true&&e.code==="credential_rejected")console.log("COMPOSIO_PREFLIGHT auth_info_probe "+JSON.stringify(await authProbe()));
  throw e;
 }
 console.log("COMPOSIO_PREFLIGHT credential_accepted; read_only; no account linked; no tool executed");
}
if(require.main===module)main().catch(e=>{console.error("COMPOSIO_PREFLIGHT failed: "+(e.safeProviderError===true?e.code:"provider_unavailable")+"; "+JSON.stringify({httpStatus:e.safeProviderError===true?e.providerStatus||null:null,requestId:e.safeProviderError===true?e.providerRequestId||null:null}));process.exitCode=1});
module.exports={main};
