import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(file, mocks={}) { const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText)(name=>mocks[name]??require(name),m,m.exports);return m.exports; }
const tickets=load('../lib/tryon/photo-ticket.ts');
const secret='test-only-secret';
const base={userId:'user',clientId:'client',organizationId:'org',path:'org/client/face-v3/user/new/processed.jpg',sourcePath:'source',previousPath:'old',previousDate:null,expires:Date.now()+60000};
test('confirmation tickets reject tampering, wrong secrets and expiry',()=>{
 const token=tickets.signPhotoTicket(base,secret);
 assert.deepEqual(tickets.readPhotoTicket(token,secret),base);
 assert.equal(tickets.readPhotoTicket(token,'wrong'),null);
 assert.equal(tickets.readPhotoTicket('a'+token,secret),null);
 assert.equal(tickets.readPhotoTicket(tickets.signPhotoTicket({...base,expires:0},secret),secret),null);
});
function fixture() {
 const row={id:'client',organization_id:'org',status:'active',tryon_face_processed_path:'old',tryon_face_validated_at:null};
 const admin={from(table){let patch=null;const filters=[];return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},is(k,v){filters.push([k,v]);return this;},update(p){patch=p;return this;},async maybeSingle(){if(table==='client_user_accounts')return {data:{client_id:'client'}};if(filters.some(([k,v])=>row[k]!==v))return {data:null};if(patch)Object.assign(row,patch);return {data:{...row}};}};},storage:{from(){return {async createSignedUrl(){return {data:{signedUrl:'https://example.test/photo'}};}};}}};
 const {photoWorkflow}=load('../lib/tryon/photo-workflow.ts',{'@/lib/supabase/server':{createAdminSupabaseClient:()=>admin,createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})}})},'@/lib/verification-auth':{isSameOrigin:()=>true},'@/lib/env':{serverEnv:{supabaseSecretKey:()=>secret}},'./face-photo-process':{processFacePhoto:()=>{throw Error('unexpected AI call');}},'./photo-ticket':tickets,'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}}});
 const request=(ticket=base)=>new Request('https://example.test/api/client/photo',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tickets.signPhotoTicket(ticket,secret)})});
 return {row,photoWorkflow,request};
}
test('two confirmations from the same starting photo cannot overwrite each other',async()=>{
 const {row,photoWorkflow,request}=fixture();
 const results=await Promise.all([photoWorkflow(request()),photoWorkflow(request({...base,path:'other'}))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(row.tryon_face_processed_path,base.path);assert.equal(row.tryon_face_status,'validada');
});
test('a ticket for another patient or uploader cannot activate a photo',async()=>{
 const {row,photoWorkflow,request}=fixture();
 assert.equal((await photoWorkflow(request({...base,clientId:'another'}))).status,409);
 assert.equal((await photoWorkflow(request({...base,userId:'another'}))).status,409);
 assert.equal(row.tryon_face_processed_path,'old');
});
test('newer active photo survives a stale confirmation',async()=>{
 const {row,photoWorkflow,request}=fixture();row.tryon_face_validated_at='2026-09-16T20:00:00Z';
 assert.equal((await photoWorkflow(request())).status,409);assert.equal(row.tryon_face_processed_path,'old');
});
