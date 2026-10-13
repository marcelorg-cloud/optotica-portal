"use strict";
// One OS process and one PostgreSQL connection per contender. No provider network.
const {Client}=require("pg"),{createGateway}=require("../lib/instrument-gateway.js");
global.fetch=async()=>{throw Error("External network forbidden in concurrency test");};
let db;
async function query(sql,values=[]){return (await db.query(sql,values)).rows;}
async function rpc(op,p,token){
 await db.query("begin");
 try{
  await db.query(token?"set local role authenticated":"set local role anon");
  await db.query("select set_config('request.jwt.claims',$1,true)",[token?JSON.stringify({sub:token,role:"authenticated"}):"{}"]);
  const rows=await query("select public.regente10_gateway($1,$2::jsonb,$3) as value",[op,JSON.stringify(p),process.env.TEST_GATEWAY_KEY]);
  await db.query("commit");return rows[0].value;
 }catch(e){await db.query("rollback");throw e;}
}
async function run(task){
 if(task.kind==="rpc")return rpc(task.op,task.payload,task.master);
 if(task.kind==="sql"){
  await db.query("begin");
  try{await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:task.master,role:"authenticated"})]);
   const rows=await query(task.sql,task.values);await db.query("commit");return rows;
  }catch(e){await db.query("rollback");throw e;}
 }
 if(task.kind==="execute"){
  const {grant:g,binding:b}=await rpc("grant_private",task.payload);
  const provider={
   tool:async()=>({slug:g.tool_slug,version:g.tool_version,contractHash:g.contract_hash,schema:{type:"object",properties:{repo:{type:"string"}},required:["repo"],additionalProperties:false}}),
   verify:async()=>({state:"no_auth"}),
   execute:async()=>{
    await query("insert into concurrency_test.provider_calls(grant_id,request_key,worker_pid) values($1,$2,$3)",[g.id,task.payload.requestKey,process.pid]);
    if(task.crashAfterProvider)process.exit(77);
    if(task.providerFails)throw Error("synthetic_provider_timeout");
    return {state:"completed",logId:"synthetic_log_"+task.payload.requestKey,result:{synthetic:true}};
   }
  };
  return createGateway({rpc,provider}).executeApproved(task.payload);
 }
 throw Error("Unknown synthetic task");
}
process.on("message",async msg=>{
 if(msg.type!=="start")return;
 try{const value=await run(msg.task);process.send({type:"result",ok:true,value});}
 catch(e){process.send({type:"result",ok:false,message:e.message,code:e.code});}
 finally{await db.end();process.disconnect();}
});
(async()=>{
 db=new Client({connectionString:process.env.TEST_DATABASE_URL,application_name:"regente-concurrency-worker",connectionTimeoutMillis:10000});
 await db.connect();await db.query("set statement_timeout='20s'");await db.query("set lock_timeout='15s'");
 const [{pid}]=await query("select pg_backend_pid() as pid");process.send({type:"ready",backendPid:pid,processPid:process.pid});
})().catch(e=>{process.send?.({type:"fatal",message:e.message});process.exit(1);});
