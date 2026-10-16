"use strict";
const {createGateway}=require("../lib/instrument-gateway.js"),{PROJECTS}=require("../lib/gateway-contract.js");
async function main(){
 if(!process.env.REGENTE_GATEWAY_KEY){console.log("GATEWAY_BOOTSTRAP",JSON.stringify({configured:false,toolsDispatched:0}));return;}
 const g=createGateway();
 for(const project of PROJECTS){
  const prepared=await g.bootstrap(project);
  console.log("GATEWAY_BOOTSTRAP",JSON.stringify({project,...prepared,toolsDispatched:0}));
  // No new credential, session, tool invocation, or OAuth link during reconcile.
  const checked=await g.reconcilePending(project,8).catch(()=>({checked:0,activated:0,failed:1,toolCalls:0}));
  console.log("GATEWAY_RECONCILE",JSON.stringify({project,...checked,toolsDispatched:0}));
 }
}
if(require.main===module)main().catch(e=>{console.error("GATEWAY_BOOTSTRAP",JSON.stringify({code:e.code||"unavailable",toolsDispatched:0}));process.exitCode=1;});
module.exports={main};
