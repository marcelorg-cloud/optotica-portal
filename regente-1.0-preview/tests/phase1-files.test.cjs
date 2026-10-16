"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),zlib=require("node:zlib");
const files=require("../lib/phase1-files.js");
function zipDoc(xml){
 const name=Buffer.from("word/document.xml"),plain=Buffer.from(xml),compressed=zlib.deflateRawSync(plain);
 const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);
 local.writeUInt32LE(plain.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(8,10);
 central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(plain.length,24);
 central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
 const cd=Buffer.concat([central,name]),part=Buffer.concat([local,name,compressed]);
 end.writeUInt32LE(cd.length,12);end.writeUInt32LE(part.length,16);
 return Buffer.concat([part,cd,end]);
}
test("extension and MIME whitelist rejects executables and contradictory types",()=>{
 assert.equal(files.kind("notes.md","text/plain").canAnalyze,true);
 assert.equal(files.kind("document.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document").canAnalyze,true);
 assert.equal(files.kind("print.pdf","application/pdf").canAnalyze,false);
 assert.equal(files.kind("photo.png","image/png").canAnalyze,false);
 assert.equal(files.kind("secret.exe","application/octet-stream"),null);
 assert.equal(files.kind("secret.txt","application/x-msdownload"),null);
});
test("UTF8 textual institutional notes can be extracted but PII is rejected",()=>{
 const s=files.textOf(Buffer.from("Relatório institucional com ação A1 e testes."),"text/plain");
 assert.match(s,/institucional/);assert.equal(files.personal(s),false);
 assert.equal(files.personal("contato: fulano@example.com"),true);
 assert.equal(files.personal("prontuário: caso 12"),true);
});
test("DOCX contents are bounded and plain text is extracted without macros",()=>{
 const b=zipDoc('<w:document><w:body><w:p><w:r><w:t>Plano &amp; entrega</w:t></w:r></w:p><w:p><w:r><w:t>Critérios seguros</w:t></w:r></w:p></w:body></w:document>');
 assert.match(files.docxXml(b),/Plano & entrega/);
 assert.match(files.textOf(b,"application/vnd.openxmlformats-officedocument.wordprocessingml.document"),/Critérios seguros/);
});
test("malformed ZIP and huge XML are rejected without extracting scripts",()=>{
 assert.throws(()=>files.docxXml(Buffer.from("not a DOCX")),/DOCX inválido/);
 assert.throws(()=>files.docxXml(zipDoc("x".repeat(250000))),/acima do limite/);
});
test("unselected attachments are never downloaded or given to the model",async()=>{
 let fetched=0;
 const db=async()=>[{filename:"plan.txt",mime:"text/plain",storage_path:"owner/mission/plan.txt",include_in_ai:false}];
 const context=await files.phase1Context({db,token:"jwt",uid:"owner",missionId:"mission",sb:"https://test.supabase.co",pk:"pk",fetcher:async()=>{fetched++;}});
 assert.equal(context.usedFiles,0);assert.equal(fetched,0);assert.equal(context.text,"");
});
test("selected private text excerpt is passed to C01 as untrusted data only",async()=>{
 const db=async()=>[{filename:"plano.txt",mime:"text/plain",storage_path:"owner/mission/plan.txt",include_in_ai:true}];
 const f=async(url,opts)=>{assert.match(url,/storage\/v1\/object\/authenticated/);assert.match(opts.headers.Authorization,/Bearer/);return new Response("Metas institucionais: consolidar o evento.",{status:200});};
 const context=await files.phase1Context({db,token:"jwt",uid:"owner",missionId:"mission",sb:"https://test.supabase.co",pk:"pk",fetcher:f});
 assert.equal(context.usedFiles,1);assert.match(context.text,/anexo_nao_confiavel/);assert.match(context.text,/consolidar o evento/);
});
test("personal data inside private attachment prevents passing content to AI",async()=>{
 const db=async()=>[{filename:"plano.txt",mime:"text/plain",storage_path:"owner/mission/plan.txt",include_in_ai:true}];
 const f=async()=>new Response("dados clínicos: pessoa exemplo",{status:200});
 await assert.rejects(()=>files.phase1Context({db,token:"jwt",uid:"owner",missionId:"mission",sb:"https://test.supabase.co",pk:"pk",fetcher:f}),/Possíveis dados pessoais/);
});
test("file download hard-limits response and rejects invalid media magic",async()=>{
 await assert.rejects(()=>files.readFile({sb:"https://test.supabase.co",pk:"pk",token:"jwt",path:"x",mime:"application/pdf",fetcher:async()=>new Response("notpdf")}),/PDF inválido/);
 await assert.rejects(()=>files.readFile({sb:"https://test.supabase.co",pk:"pk",token:"jwt",path:"x",mime:"text/plain",fetcher:async()=>new Response("x",{headers:{"content-length":String(3145729)}})}),/acima do limite/);
});
