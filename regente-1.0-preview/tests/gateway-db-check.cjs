"use strict";
const fs=require("node:fs"),path=require("node:path"),{PGlite}=require("@electric-sql/pglite");
const root=path.join(__dirname,"..");
(async()=>{const db=new PGlite();try{
 await db.exec(fs.readFileSync(path.join(root,"tests/gateway-db-schema-fixture.sql"),"utf8"));
 for(const file of fs.readdirSync(path.join(root,"supabase/migrations")).sort())await db.exec(fs.readFileSync(path.join(root,"supabase/migrations",file),"utf8"));
 const r=await db.exec(fs.readFileSync(path.join(root,"tests/gateway-db-rollback.sql"),"utf8"));
 console.log(JSON.stringify(r.at(-1).rows));
 const clean=await db.query("select count(*)::int as toolfixtures from regente10_portao.tools");
 if(clean.rows[0].toolfixtures!==0)throw Error("Fixture rollback failed");
 }finally{await db.close();}})().catch(e=>{console.error(JSON.stringify({message:e.message,detail:e.detail,hint:e.hint,where:e.where}));process.exitCode=1;});
