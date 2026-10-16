"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
process.env.SUPABASE_URL="https://fake.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY="public_test";
const api=require("../api/attachments.js");
const USER="11111111-1111-4111-8111-111111111111",MID="22222222-2222-4222-8222-222222222222",FID="33333333-3333-4333-8333-333333333333";
const FILE={id:FID,filename:"plano.txt",storage_path:USER+"/"+MID+"/"+FID+".txt",mime:"text/plain",size_bytes:42,include_in_ai:true};
const req=(method="GET",data={},query={missionId:MID})=>({method,body:{missionId:MID,...data},query,headers:{authorization:"Bearer test.jwt.token",host:"local.test",origin:"https://local.test"}});
const res=()=>({statusCode:200,value:null,setHeader(){return this},status(n){this.statusCode=n;return this},json(v){this.value=v;return this}});
function mocked({master=true,status="afinamento",emergency=false}={}){
 const calls=[];
 global.fetch=async(url,options={})=>{
  const uri=String(url),method=options.method||"GET";calls.push({uri,method,body:options.body||null});
  let val=[];
  if(uri.endsWith("/auth/v1/user"))val={id:USER};
  else if(uri.includes("/system_admins?"))val=master?[{user_id:USER}]:[];
  else if(uri.includes("/regente10_missions?"))val=[{id:MID,owner_id:USER,project:"ensavim",status,paused:false}];
  else if(uri.includes("/regente10_controls?"))val=[{emergency_stop:emergency}];
  else if(uri.includes("/regente10_mission_files?")&&method==="GET")val=[FILE];
  else if(uri.endsWith("/regente10_mission_files")&&method==="POST")val=[FILE];
  else if(uri.includes("/regente10_mission_files?")&&method==="DELETE")val=null;
  else if(uri.includes("/storage/v1/object/")&&method==="DELETE")val={message:"Successfully deleted"};
  else throw Error("Unexpected request "+uri);
  return new Response(val===null?"":JSON.stringify(val),{status:200,headers:{"Content-Type":"application/json"}});
 };
 return calls;
}
test("anonymous attachment request has zero upstream effects",async()=>{
 let called=0;global.fetch=async()=>{called++;throw Error("unexpected");};
 const q=req();q.headers.authorization="";const r=res();
 await api(q,r);assert.equal(r.statusCode,401);assert.equal(called,0);
});
test("non-Master cannot list private attachments",async()=>{
 const calls=mocked({master:false}),r=res();await api(req(),r);
 assert.equal(r.statusCode,403);assert(!calls.some(x=>x.uri.includes("/regente10_mission_files")));
});
test("cross-origin upload preparation is blocked prior to contacting Storage",async()=>{
 const calls=mocked(),r=res(),q=req("POST",{action:"prepare",fileName:"plano.txt",size:100});q.headers.origin="https://evil.test";
 await api(q,r);assert.equal(r.statusCode,403);assert.equal(calls.length,0);
});
test("mission only exposes its own private attachment metadata",async()=>{
 mocked();const r=res();await api(req(),r);
 assert.equal(r.statusCode,200);assert.equal(r.value.files.length,1);
 assert.equal(r.value.files[0].id,FID);assert.equal(r.value.bucket,"regente10-phase1");
 assert.deepEqual(r.value.supportedForAi,["txt","md","csv","json","docx"]);
});
test("private ticket uses owner/mission/random-id, never provider service key",async()=>{
 const calls=mocked(),r=res();
 await api(req("POST",{action:"prepare",fileName:"plano.txt",mime:"text/plain",size:42}),r);
 assert.equal(r.statusCode,200);assert.match(r.value.path,new RegExp("^"+USER+"/"+MID+"/[0-9a-f-]{36}\\.txt$"));
 assert(!calls.some(x=>x.uri.includes("/storage/v1/object/")));
});
test("refuses file registration outside owner/mission even with Master JWT",async()=>{
 const calls=mocked(),r=res();
 await api(req("POST",{action:"register",id:FID,fileName:"plano.txt",mime:"text/plain",size:42,path:"other/mission/"+FID+".txt",acknowledgedNonPersonal:true}),r);
 assert.equal(r.statusCode,400);assert(!calls.some(x=>x.method==="POST"&&x.uri.endsWith("/regente10_mission_files")));
});
test("only content attested nonpersonal and text type can be marked for AI",async()=>{
 const calls=mocked(),r=res();
 await api(req("POST",{action:"register",id:FID,fileName:"foto.png",mime:"image/png",size:42,path:USER+"/"+MID+"/"+FID+".png",includeInAi:true,acknowledgedNonPersonal:true}),r);
 assert.equal(r.statusCode,400);assert(!calls.some(x=>x.method==="POST"&&x.uri.endsWith("/regente10_mission_files")));
});
test("Master can remove exactly its mission file through Storage API before metadata deletion",async()=>{
 const calls=mocked(),r=res();await api(req("POST",{action:"remove",id:FID}),r);
 assert.equal(r.statusCode,200);
 const deletions=calls.filter(x=>x.method==="DELETE").map(x=>x.uri);
 assert.equal(deletions.length,2);assert(deletions[0].includes("/storage/v1/object/regente10-phase1/"));
 assert(deletions[1].includes("/regente10_mission_files?"));
});
test("completed mission rejects new phase-1 upload ticket",async()=>{
 mocked({status:"concluida"});const r=res();
 await api(req("POST",{action:"prepare",fileName:"plano.txt",mime:"text/plain",size:42}),r);
 assert.equal(r.statusCode,409);
});
test("global emergency stop prevents upload mutation",async()=>{
 const calls=mocked({emergency:true}),r=res();
 await api(req("POST",{action:"prepare",fileName:"plano.txt",mime:"text/plain",size:42}),r);
 assert.equal(r.statusCode,423);assert(!calls.some(x=>x.method==="POST"&&x.uri.includes("/regente10_mission_files")));
});
