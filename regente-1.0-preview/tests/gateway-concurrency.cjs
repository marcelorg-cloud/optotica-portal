"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict"),{fork}=require("node:child_process"),{Client}=require("pg"),{hash}=require("../lib/gateway-contract.js");
const root=path.join(__dirname,".."),results=[],workers=new Set(),backends=new Set(),processes=new Set();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let db,admin,database,owner,fixtures,serverVersion,maxBlocked=0;
const key="synthetic_gateway_concurrency_"+crypto.randomBytes(24).toString("hex");
async function rows(sql,values=[]){return (await db.query(sql,values)).rows;}
async function rpc(op,p,master=false){
 await db.query("begin");
 try{
  await db.query(master?"set local role authenticated":"set local role anon");
  await db.query("select set_config('request.jwt.claims',$1,true)",[master?JSON.stringify({sub:owner,role:"authenticated"}):"{}"]);
  const value=(await rows("select public.regente10_gateway($1,$2::jsonb,$3) as value",[op,JSON.stringify(p),key]))[0].value;
  await db.query("commit");return value;
 }catch(e){await db.query("rollback");throw e;}
}
async function reset(cap=5){
 await db.query("truncate concurrency_test.provider_calls, concurrency_test.budget_observations");
 await db.query("delete from regente10_portao.events; delete from regente10_portao.grants; delete from regente10_portao.scopes; delete from public.regente10_resources where alias like 'GW/%'; delete from public.regente10_budget_reservations; delete from public.regente10_ai_calls");
 await db.query("update public.regente10_missions set paused=false,envelope_approved_at=clock_timestamp(),status='em_execucao'; update public.regente10_controls set emergency_stop=false; update regente10_portao.bindings set verified_at=clock_timestamp(),revision=1,status='no_auth'");
 await db.query("update public.regente10_mission_budgets set reserved_brl=0,metered_brl=0,cap_brl=$1",[cap]);
 await db.query("truncate concurrency_test.budget_observations");
}
async function grant({project="optotica",amount=1,maxCalls=1}={}){
 const f=fixtures[project],args={repo:"synthetic_project_only"},argsHash=hash(args),contractHash="a".repeat(64);
 const sc=await rpc("scope",{project,bindingId:f.binding,toolSlug:"TEST_FIXTURE_ONLY",version:"test_v1",argsHash,dataClass:"internal",description:"Synthetic fixture without external tools",confirmNonPersonal:true},true);
 const resourceHash=hash((await rpc("resource",{project,resourceAlias:sc.resourceAlias,operation:"instrument.execute"})).chain);
 const g=await rpc("grant",{project,missionId:f.mission,bindingId:f.binding,resourceAlias:sc.resourceAlias,operation:"instrument.execute",toolSlug:"TEST_FIXTURE_ONLY",version:"test_v1",contractHash,arguments:args,argsHash,resourceHash,unitMaxBrl:amount,maxCalls,ttlMinutes:15,priceSource:"Synthetic test tariff only",confirm:true,costVerified:true},true);
 return {project,grantId:g.grantId,argsHash,contractHash,resourceHash};
}
const claimTask=(g,requestKey=crypto.randomUUID())=>({kind:"rpc",op:"claim",payload:{...g,requestKey}});
const eventTask=(op,g,eventId,extra={})=>({kind:"rpc",op,payload:{project:g.project,eventId,...extra}});
const executeTask=(g,requestKey=crypto.randomUUID(),extra={})=>({kind:"execute",payload:{project:g.project,grantId:g.grantId,requestKey},...extra});
async function spawn(task){
 const env={PATH:process.env.PATH,TEST_DATABASE_URL:database.url,TEST_GATEWAY_KEY:key};
 const child=fork(path.join(__dirname,"gateway-concurrency-worker.cjs"),[],{env,stdio:["ignore","ignore","pipe","ipc"]});workers.add(child);
 let stderr="";child.stderr.on("data",d=>{stderr+=d.toString().slice(0,2000);});
 const ready=new Promise((resolve,reject)=>{child.on("message",m=>{if(m.type==="ready"){backends.add(m.backendPid);processes.add(m.processPid);resolve(m);}if(m.type==="fatal")reject(Error(m.message));});child.on("error",reject);child.on("exit",code=>{if(code)reject(Error("Worker startup failed: "+code));});});
 const done=new Promise(resolve=>{let result;child.on("message",m=>{if(m.type==="result")result=m;});child.on("exit",code=>{workers.delete(child);resolve(result||{ok:false,code:"process_exit",exitCode:code,message:stderr});});});
 const info=await ready;return {child,info,done,start:()=>child.send({type:"start",task})};
}
async function waitBlocked(pids){
 const until=Date.now()+10000;
 while(Date.now()<until){
  const [{n}]=await rows("select count(*)::int as n from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0",[pids]);
  maxBlocked=Math.max(maxBlocked,n);if(n===pids.length)return;await delay(25);
 }
 throw Error("Not all independent backends reached the lock barrier");
}
async function race(tasks,{holdMission}={}){
 const contenders=await Promise.all(tasks.map(spawn));
 let blocker;
 try{
  if(holdMission){blocker=new Client({connectionString:database.url});await blocker.connect();await blocker.query("begin");await blocker.query("select id from public.regente10_missions where id=$1 for update",[holdMission]);}
  for(const w of contenders)w.start();
  if(blocker){await waitBlocked(contenders.map(w=>w.info.backendPid));await blocker.query("commit");}
  return await Promise.all(contenders.map(w=>w.done));
 }finally{if(blocker){await blocker.query("rollback").catch(()=>{});await blocker.end();}}
}
async function invariant(){
 const bad=await rows(`select b.mission_id from public.regente10_mission_budgets b
 where b.reserved_brl<0 or b.metered_brl<0 or b.reserved_brl+b.metered_brl>b.cap_brl
 or b.reserved_brl <> coalesce((select sum(amount_brl) from regente10_portao.events e where e.mission_id=b.mission_id and state in('reserved','dispatched','uncertain')),0)
 + coalesce((select sum(amount_reserved_brl) from public.regente10_budget_reservations r where r.mission_id=b.mission_id and state in('reserved','uncertain')),0)
 or b.metered_brl <> coalesce((select sum(amount_brl) from regente10_portao.events e where e.mission_id=b.mission_id and state='completed'),0)
 + coalesce((select sum(amount_metered_brl) from public.regente10_budget_reservations r where r.mission_id=b.mission_id and state='settled'),0)`);
 assert.deepEqual(bad,[],"Ledger disagrees with events/reservations");
 assert.equal((await rows("select count(*)::int n from concurrency_test.budget_observations where reserved_brl<0 or metered_brl<0 or reserved_brl+metered_brl>cap_brl"))[0].n,0);
 assert.equal((await rows("select count(*)::int n from (select grant_id,request_key from concurrency_test.provider_calls group by grant_id,request_key having count(*)>1) d"))[0].n,0,"Duplicate synthetic provider side effect");
}
async function balance(project="optotica"){return (await rows("select reserved_brl::text reserved,metered_brl::text metered from public.regente10_mission_budgets where mission_id=$1",[fixtures[project].mission]))[0];}
async function scenario(name,fn){
 const started=Date.now();try{await fn();await invariant();results.push({name,passed:true,ms:Date.now()-started});console.log("PASS "+name);}
 catch(e){results.push({name,passed:false,message:e.message,ms:Date.now()-started});console.error("FAIL "+name+": "+e.message);}
}
function successes(r,n,denial){assert.equal(r.filter(x=>x.ok).length,n,JSON.stringify(r));for(const x of r.filter(x=>!x.ok))if(denial)assert.match(x.message,denial);}
async function main(){
 // Never accept a production DSN. The acknowledged server itself must be disposable.
 if(process.env.REGENTE_PG_ISOLATED!=="1")throw Error("Set REGENTE_PG_ISOLATED=1 for an explicitly disposable PostgreSQL server");
 const url=new URL(process.env.REGENTE_PG_ADMIN_URL||"");
 if(url.protocol!=="postgresql:"||!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.pathname!=="/postgres"||url.search||url.hash)throw Error("Only a loopback disposable server's /postgres database is accepted");
 const name="regente_gateway_concurrency_"+crypto.randomBytes(10).toString("hex");
 admin=new Client({connectionString:url.href,connectionTimeoutMillis:10000});await admin.connect();
 await admin.query('create database "'+name+'"');url.pathname="/"+name;database={name,url:url.href};
 db=new Client({connectionString:database.url});await db.connect();
 serverVersion=(await rows("show server_version"))[0].server_version;
 // Roles are cluster-global, but no existing role is altered.
 await db.query("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end $$");
 await db.query(fs.readFileSync(path.join(__dirname,"gateway-db-schema-fixture.sql"),"utf8").replace("create role anon;create role authenticated;",""));
 await db.query(fs.readFileSync(path.join(__dirname,"gateway-concurrency-ai-fixture.sql"),"utf8"));
 await db.query(fs.readFileSync(path.join(root,"migrations/20261012_phase1_budget_approval_and_reservations.sql"),"utf8"));
 for(const file of fs.readdirSync(path.join(root,"supabase/migrations")).sort()){
  if(process.env.REGENTE_TEST_BASELINE==="1"&&file.includes("gateway_concurrency"))continue;
  await db.query(fs.readFileSync(path.join(root,"supabase/migrations",file),"utf8"));
 }
 await db.query(fs.readFileSync(path.join(__dirname,"gateway-db-rollback.sql"),"utf8"));
 owner=(await rows("select owner_id from regente10_portao.configuration"))[0].owner_id;
 await db.query("update regente10_portao.configuration set key_hash=encode(extensions.digest($1,'sha256'),'hex')",[key]);
 fixtures=Object.fromEntries((await rows("select p.project_id,p.mission_id mission,(select id from regente10_portao.bindings b where b.project_id=p.project_id limit 1) binding from regente10_portao.projects p")).map(f=>[f.project_id,f]));
 for(const [project,f] of Object.entries(fixtures)){
  await db.query("update regente10_portao.bindings set toolkit='test_fixture_only',status='no_auth',no_auth=true,revision=1,verified_at=clock_timestamp() where id=$1",[f.binding]);
  await db.query("insert into regente10_portao.tools(project_id,binding_id,slug,version,contract_hash,schema,name) values($1,$2,'TEST_FIXTURE_ONLY','test_v1',$3,'{\"type\":\"object\"}','Synthetic fixture')",[project,f.binding,"a".repeat(64)]);
  await rpc("cap",{project,capBrl:5,fx:5,confirm:true},true);
 }
 await db.query(`create schema concurrency_test;
 create table concurrency_test.provider_calls(grant_id uuid,request_key uuid,worker_pid int);
 create table concurrency_test.budget_observations(reserved_brl numeric,metered_brl numeric,cap_brl numeric);
 create function concurrency_test.observe_budget() returns trigger language plpgsql as $$ begin insert into concurrency_test.budget_observations values(new.reserved_brl,new.metered_brl,new.cap_brl);return new;end $$;
 create trigger observe_budget after update on public.regente10_mission_budgets for each row execute function concurrency_test.observe_budget()`);
 const mission=fixtures.optotica.mission;
 await scenario("24 simultaneous reservations respect shared cap",async()=>{
  await reset();const gs=[];for(let i=0;i<24;i++)gs.push(await grant({amount:0.75}));
  const r=await race(gs.map(g=>claimTask(g)),{holdMission:mission});successes(r,6,/Insufficient monetary/);assert.deepEqual(await balance(),{reserved:"4.5000",metered:"0.0000"});
 });
 await scenario("16 identical request keys create one reservation and one receipt",async()=>{
  await reset();const g=await grant(),t=claimTask(g),r=await race(Array(16).fill(t),{holdMission:mission});successes(r,16);assert.equal(r.filter(x=>!x.value.reused).length,1);assert.equal(new Set(r.map(x=>x.value.event.id)).size,1);assert.equal((await balance()).reserved,"1.0000");
 });
 await scenario("Single-call grant cannot be consumed twice under distinct keys",async()=>{
  await reset();const g=await grant(),r=await race(Array.from({length:16},()=>claimTask(g)),{holdMission:mission});successes(r,1,/Grant expired or exhausted/);
 });
 await scenario("Explicit three-call authorization admits exactly three calls",async()=>{
  await reset();const g=await grant({maxCalls:3}),r=await race(Array.from({length:12},()=>claimTask(g)),{holdMission:mission});successes(r,3,/Grant expired or exhausted/);
 });
 await scenario("Cross-project request-key collision rolls back losing reservation",async()=>{
  await reset();const a=await grant(),b=await grant({project:"ensavim"}),rk=crypto.randomUUID();const r=await race([claimTask(a,rk),claimTask(b,rk)]);successes(r,1,/Idempotency collision|duplicate key/);
  assert.equal((await rows("select sum(reserved_brl)::text n from public.regente10_mission_budgets"))[0].n,"1.0000");
 });
 await scenario("16 simultaneous arm attempts yield one dispatch permit",async()=>{
  await reset();const g=await grant(),c=await rpc("claim",claimTask(g).payload),r=await race(Array(16).fill(eventTask("arm",g,c.event.id)),{holdMission:mission});successes(r,1,/Dispatch already claimed/);
 });
 await scenario("Concurrent completion commits the ceiling once",async()=>{
  await reset();const g=await grant(),c=await rpc("claim",claimTask(g).payload);await rpc("arm",eventTask("arm",g,c.event.id).payload);
  const r=await race(Array(16).fill(eventTask("complete",g,c.event.id,{state:"completed",logId:"synthetic_log",result:{synthetic:true}})),{holdMission:mission});successes(r,1,/already settled/);assert.deepEqual(await balance(),{reserved:"0.0000",metered:"1.0000"});
 });
 await scenario("Concurrent cancellation refunds only undispatched work once",async()=>{
  await reset();const g=await grant(),c=await rpc("claim",claimTask(g).payload),r=await race(Array(16).fill(eventTask("cancel",g,c.event.id)),{holdMission:mission});successes(r,1,/Only undispatched/);assert.equal((await balance()).reserved,"0.0000");await assert.rejects(rpc("claim",claimTask(g).payload),/exhausted/);
 });
 await scenario("Actual Gateway across 16 processes invokes synthetic provider once",async()=>{
  await reset();const g=await grant(),t=executeTask(g),r=await race(Array(16).fill(t),{holdMission:mission});successes(r,16);assert.equal((await rows("select count(*)::int n from concurrency_test.provider_calls"))[0].n,1);assert.equal((await balance()).metered,"1.0000");
 });
 await scenario("Provider timeout retains reservation and never retries",async()=>{
  await reset();const g=await grant(),t=executeTask(g,crypto.randomUUID(),{providerFails:true}),r=await race(Array(12).fill(t),{holdMission:mission});successes(r,12);assert.equal((await rows("select count(*)::int n from concurrency_test.provider_calls"))[0].n,1);assert.equal((await balance()).reserved,"1.0000");assert.equal((await rpc("receipt",t.payload)).event.state,"uncertain");await assert.rejects(rpc("cancel",{project:g.project,eventId:r[0].value.eventId}),/Only undispatched/);
 });
 await scenario("Worker dies after provider effect: dispatched reserve survives replay",async()=>{
  await reset();const g=await grant(),t=executeTask(g,crypto.randomUUID(),{crashAfterProvider:true}),[r]=await race([t]);assert.equal(r.exitCode,77);
  const receipt=await rpc("receipt",t.payload);assert.equal(receipt.event.state,"dispatched");const [retry]=await race([{...t,crashAfterProvider:false}]);assert.equal(retry.value.reused,true);assert.equal((await rows("select count(*)::int n from concurrency_test.provider_calls"))[0].n,1);assert.equal((await balance()).reserved,"1.0000");await assert.rejects(rpc("claim",claimTask(g).payload),/exhausted/);
 });
 await scenario("Disconnect before claim commit rolls back budget, grant and event",async()=>{
  await reset();const g=await grant(),t=claimTask(g),client=new Client({connectionString:database.url});await client.connect();await client.query("begin");await client.query("select public.regente10_gateway('claim',$1::jsonb,$2)",[JSON.stringify(t.payload),key]);await client.end();
  assert.equal((await balance()).reserved,"0.0000");const c=await rpc("claim",t.payload);assert.equal(c.reused,false);
 });
 await scenario("Failure inserting event rolls back all earlier claim mutations",async()=>{
  await reset();const g=await grant(),t=claimTask(g);
  await db.query("create function concurrency_test.fail_event() returns trigger language plpgsql as $$ begin if new.grant_id is not null then raise exception 'synthetic_event_failure';end if;return new;end $$; create trigger fail_event before insert on regente10_portao.events for each row execute function concurrency_test.fail_event()");
  try{await assert.rejects(rpc("claim",t.payload),/synthetic_event_failure/);assert.equal((await balance()).reserved,"0.0000");assert.equal((await rows("select used_calls from regente10_portao.grants where id=$1",[g.grantId]))[0].used_calls,0);}
  finally{await db.query("drop trigger fail_event on regente10_portao.events;drop function concurrency_test.fail_event()");}
  assert.equal((await rpc("claim",t.payload)).reused,false);
 });
 await scenario("Text and instruments race on the same monetary cap",async()=>{
  await reset(0.5);const gs=[];for(let i=0;i<8;i++)gs.push(await grant({amount:0.1}));
  const texts=Array.from({length:8},(_,slot)=>({kind:"sql",master:owner,sql:"select public.regente10_reserve_ai_budget($1,'executor',$2,'gpt-4.1-mini',1000,100) as job",values:[mission,slot]}));
  const r=await race([...gs.map(g=>claimTask(g)),...texts],{holdMission:mission});assert(r.some(x=>x.ok));assert(r.some(x=>!x.ok));for(const x of r.filter(x=>!x.ok))assert.match(x.message,/monetary|Teto monetário/);
  const [{total}]=await rows("select (reserved_brl+metered_brl)::float8 total from public.regente10_mission_budgets where mission_id=$1",[mission]);assert(total<=0.5);
 });
 await scenario("Text settlement and instrument reservation do not lose updates",async()=>{
  await reset();const text=(await rows("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner})]));assert(text);
  const job=(await rows("select public.regente10_reserve_ai_budget($1,'executor',0,'gpt-4.1-mini',1000,100) job",[mission]))[0].job;
  const gs=[];for(let i=0;i<12;i++)gs.push(await grant({amount:0.4}));
  const settle={kind:"sql",master:owner,sql:"select public.regente10_settle_ai_budget($1,100,0,10) as value",values:[job]};
  const r=await race([...gs.map(g=>claimTask(g)),...Array(6).fill(settle)]);successes(r,18);assert.equal(r.filter(x=>x.value?.[0]?.value?.state==="settled").length,1);
 });
 await scenario("Concurrent arm/cancel race cannot both dispatch and refund",async()=>{
  await reset();const g=await grant(),c=await rpc("claim",claimTask(g).payload),r=await race([eventTask("arm",g,c.event.id),eventTask("cancel",g,c.event.id)],{holdMission:mission});successes(r,1,/Dispatch already|Only undispatched/);
 });
 await scenario("Grant revocation committed while arm waits blocks dispatch",async()=>{
  await reset();const g=await grant(),c=await rpc("claim",claimTask(g).payload),blocker=new Client({connectionString:database.url});await blocker.connect();await blocker.query("begin");await blocker.query("select id from public.regente10_missions where id=$1 for update",[mission]);
  const w=await spawn(eventTask("arm",g,c.event.id));w.start();await waitBlocked([w.info.backendPid]);await blocker.query("update regente10_portao.grants set status='revoked' where id=$1",[g.grantId]);await blocker.query("commit");await blocker.end();assert.match((await w.done).message,/revoked/);
 });
 await scenario("Emergency stop committed while arm waits blocks dispatch",async()=>{
  await reset();const g=await grant(),c=await rpc("claim",claimTask(g).payload),blocker=new Client({connectionString:database.url});await blocker.connect();await blocker.query("begin");await blocker.query("select id from public.regente10_missions where id=$1 for update",[mission]);
  const w=await spawn(eventTask("arm",g,c.event.id));w.start();await waitBlocked([w.info.backendPid]);await blocker.query("update public.regente10_controls set emergency_stop=true where owner_id=$1",[owner]);await blocker.query("commit");await blocker.end();const r=await w.done;assert.equal(r.ok,false,"Emergency stop bypassed after lock wait");assert.match(r.message,/Emergency stop/);
 });
 await scenario("Expired authorization cannot dispatch after lock wait",async()=>{
  await reset();const g=await grant(),c=await rpc("claim",claimTask(g).payload);
  await db.query("update regente10_portao.grants set expires_at=clock_timestamp()+interval '1 second' where id=$1",[g.grantId]);
  const blocker=new Client({connectionString:database.url});await blocker.connect();await blocker.query("begin");await blocker.query("select id from public.regente10_missions where id=$1 for update",[mission]);
  const w=await spawn(eventTask("arm",g,c.event.id));w.start();await waitBlocked([w.info.backendPid]);await delay(1200);await blocker.query("commit");await blocker.end();const r=await w.done;assert.equal(r.ok,false,"Expired grant dispatched using transaction start time");assert.match(r.message,/revoked|expired/);
 });
 await scenario("S00 cross-project, credentials, unapproved grants and direct ledger writes stay denied",async()=>{
  await reset();const g=await grant();await assert.rejects(rpc("claim",{...claimTask(g).payload,project:"ensavim"}),/outside project/);
  await assert.rejects(rpc("grant",{project:"optotica"}),/Master approval/);
  await db.query("begin;set local role authenticated");try{await assert.rejects(db.query("update public.regente10_mission_budgets set cap_brl=999"),/permission denied/);}finally{await db.query("rollback");}
  await assert.rejects(db.query("select regente10_portao.assert_instrument('SUPABASE_EXECUTE_SQL','{\"project_id\":\"synthetic\"}')"),/Privileged route/);
 });
 assert(maxBlocked>=16,"No proof of at least sixteen simultaneously blocked PostgreSQL backends");
}
(async()=>{
 let fatal;
 try{await main();}catch(e){fatal=e.message;console.error("FATAL "+fatal);process.exitCode=1;}
 finally{
  for(const child of workers)child.kill("SIGKILL");
  if(db)await db.end().catch(()=>{});
  if(admin){if(database)await admin.query('drop database "'+database.name+'" with (force)').catch(e=>{fatal="Disposable database cleanup failed: "+e.message;});await admin.end().catch(()=>{});}
  const report={serverVersion,baseline:process.env.REGENTE_TEST_BASELINE==="1",independentBackendCount:backends.size,independentProcessCount:processes.size,maxSimultaneouslyBlocked:maxBlocked,paidExternalCalls:0,results,...(fatal?{fatal}:{})};
  if(process.env.REGENTE_PG_REPORT)fs.writeFileSync(process.env.REGENTE_PG_REPORT,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,serverVersion,independentBackendCount:backends.size,maxSimultaneouslyBlocked:maxBlocked,paidExternalCalls:0}));
  if(fatal||results.some(x=>!x.passed))process.exitCode=1;
 }
})();
