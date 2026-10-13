"use strict";
// Build-time read-only credential check; raw provider payloads never printed (only the redacted summary).
const {providerGet}=require("../lib/composio-readonly.js");
const {authProbe}=require("./composio-auth-probe.cjs");
async function main(){
 if(!process.env.COMPOSIO_API_KEY){console.log("COMPOSIO_PREFLIGHT not_configured; integration remains disabled");return;}
 const key=process.env.COMPOSIO_API_KEY;
 // Booleans only. trim() cannot see internal line breaks, spaces or zero-width characters.
 console.log("COMPOSIO_PREFLIGHT input_checks "+JSON.stringify({present:true,outerWhitespace:key!==key.trim(),quoted:/^[\"']|[\"']$/.test(key),masked:key.includes("**"),differentKeyKind:/^(uak_|ck_)/.test(key),projectKeyPrefix:key.trim().startsWith("ak_"),internalNonTokenCharacters:!/^[\x21-\x7E]+$/.test(key.trim())}));
 try{await providerGet("configs");}catch(e){
   if(e.safeProviderError===true&&e.code==="credential_rejected")console.log("COMPOSIO_PREFLIGHT project_key_probe "+JSON.stringify(await authProbe()));
  throw e;
 }
 console.log("COMPOSIO_PREFLIGHT credential_accepted; read_only; no account linked; no tool executed");
}
function reportFailure(e){console.error("COMPOSIO_PREFLIGHT failed: "+(e.safeProviderError===true?e.code:"provider_unavailable")+"; "+JSON.stringify({httpStatus:e.safeProviderError===true?e.providerStatus||null:null,requestId:e.safeProviderError===true?e.providerRequestId||null:null,providerError:e.safeProviderError===true?e.providerError||null:null}));process.exitCode=1;}
if(require.main===module)main().catch(reportFailure);
module.exports={main,reportFailure};
