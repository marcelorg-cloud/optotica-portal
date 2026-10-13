"use strict";
const {createGateway}=require("../lib/instrument-gateway.js"),{PROJECTS}=require("../lib/gateway-contract.js");
async function main(){
 if(!process.env.REGENTE_GATEWAY_KEY){console.log("GATEWAY_BOOTSTRAP",JSON.stringify({configured:false,toolsDispatched:0}));return;}
 const g=createGateway();
 for(const project of PROJECTS){const counts=await g.bootstrap(project);console.log("GATEWAY_BOOTSTRAP",JSON.stringify({project,...counts,toolsDispatched:0}));}
}
if(require.main===module)main().catch(e=>{console.error("GATEWAY_BOOTSTRAP",JSON.stringify({code:e.code||"unavailable",toolsDispatched:0}));process.exitCode=1;});
module.exports={main};
