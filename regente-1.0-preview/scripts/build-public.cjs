"use strict";
const fs=require("node:fs"),path=require("node:path");
async function build(){
 const preflight=require("./composio-preflight.cjs");
 try{await preflight.main();}catch(e){preflight.reportFailure(e);console.warn("COMPOSIO_PREFLIGHT unavailable; core panel build continues without declaring bridge ready.");}
 try{await require("./gateway-bootstrap.cjs").main();}catch(e){console.warn("GATEWAY_BOOTSTRAP deferred; Master can retry from connection center.");}
 const root=path.join(__dirname,".."),output=path.join(root,"public");
 fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output);
 for(const file of ["login.html","session-client.js","oauth-return.html"])fs.copyFileSync(path.join(root,file),path.join(output,file));
}
if(require.main===module)build().catch(()=>{console.error("PUBLIC_BUILD failed; inspect COMPOSIO_PREFLIGHT diagnostics");process.exitCode=1});
module.exports={build};
