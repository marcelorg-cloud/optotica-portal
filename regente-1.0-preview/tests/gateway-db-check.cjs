"use strict";
const fs=require("node:fs"),path=require("node:path"),{PGlite}=require("@electric-sql/pglite");
const root=path.join(__dirname,"..");
(async()=>{const db=new PGlite();try{
 await db.exec(fs.readFileSync(path.join(root,"tests/gateway-db-schema-fixture.sql"),"utf8"));
 // PGlite test fixture models only regente10_portao. Other migrations use native
 // Supabase Storage/Auth and are verified against the actual isolated Regente
 // schema in Supabase, never silently applied to an incomplete PGlite fixture.
 const migrations=fs.readdirSync(path.join(root,"supabase/migrations")).sort()
  .filter(file=>/regente10_(?:operational_gateway|gateway_)/.test(file));
 if(migrations.length!==5)throw Error("Gateway migrations missing from PGlite fixture");
 for(const file of migrations)await db.exec(fs.readFileSync(path.join(root,"supabase/migrations",file),"utf8"));
 const r=await db.exec(fs.readFileSync(path.join(root,"tests/gateway-db-rollback.sql"),"utf8"));
 console.log(JSON.stringify(r.at(-1).rows));
 const clean=await db.query("select count(*)::int as toolfixtures from regente10_portao.tools");
 if(clean.rows[0].toolfixtures!==0)throw Error("Fixture rollback failed");
 }finally{await db.close();}})().catch(e=>{console.error(JSON.stringify({message:e.message,detail:e.detail,hint:e.hint,where:e.where}));process.exitCode=1;});
