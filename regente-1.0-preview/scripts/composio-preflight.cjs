"use strict";
// Build-time read-only credential check; provider payloads never printed.
const {providerGet}=require("../lib/composio-readonly.js");
async function main(){
 if(!process.env.COMPOSIO_API_KEY){console.log("COMPOSIO_PREFLIGHT not_configured; integration remains disabled");return;}
 await providerGet("configs");
 console.log("COMPOSIO_PREFLIGHT credential_accepted; read_only; no account linked; no tool executed");
}
if(require.main===module)main().catch(e=>{console.error("COMPOSIO_PREFLIGHT failed: "+(e.code||"provider_unavailable"));process.exitCode=1});
module.exports={main};
