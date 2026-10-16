"use strict";
// Phase 1 institutional attachments. Never execute content from files, never
// forward raw files or provider credentials to the model. Master JWT + RLS.
const zlib=require("node:zlib");
const BUCKET="regente10-phase1",MAX_BYTES=3145728;
const AI_TYPES=new Set(["text/plain","text/markdown","text/csv","application/json","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const allTypes={
 txt:"text/plain",md:"text/markdown",csv:"text/csv",json:"application/json",
 pdf:"application/pdf",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 png:"image/png",jpg:"image/jpeg"
};
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const error=(s,status=400)=>Object.assign(new Error(s),{status});
function kind(filename,explicitMime){
 const name=String(filename||"").trim();
 const ext=name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
 const mime=allTypes[ext];
 // Browser MIME often differs for md/csv/json; whitelist from extension.
 if(!name||name.length>130||!mime)return null;
 const known=String(explicitMime||"").trim().toLowerCase();
 if(known && known!==mime && !(ext==="txt"&&known==="text/plain") &&
  !(ext==="md"&&known==="text/plain") && !(ext==="csv"&&known==="application/vnd.ms-excel") &&
  !(ext==="jpg"&&known==="image/jpeg"))return null;
 return {extension:ext,mime,canAnalyze:AI_TYPES.has(mime)};
}
function personal(text){
 return /(?:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b\d{3}\.?\d{3}\.?\d{3}[- ]?\d{2}\b|(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}\b|(?:nome do paciente|cpf do paciente|prontuário|receita individual|dados clínicos)\s*[:\-])/i.test(String(text||""));
}
function entities(s){return s.replace(/&(?:lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/g,t=>{
 if(t==="&lt;")return "<";if(t==="&gt;")return ">";if(t==="&amp;")return "&";
 if(t==="&quot;")return '"';if(t==="&apos;")return "'";
 if(/^&#x/i.test(t))return String.fromCodePoint(Math.min(0x10ffff,parseInt(t.slice(3,-1),16)||0xfffd));
 if(/^&#/.test(t))return String.fromCodePoint(Math.min(0x10ffff,parseInt(t.slice(2,-1),10)||0xfffd));return t;
});}
function docxXml(buffer){
 if(buffer.length>MAX_BYTES||buffer.readUInt32LE(0)!==0x04034b50)throw error("Documento DOCX inválido");
 // Parse central directory instead of trusting local header sizes/data descriptors.
 let end=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)
  if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw error("Diretório ZIP do DOCX indisponível");
 const entries=buffer.readUInt16LE(end+10),dir=buffer.readUInt32LE(end+16);
 if(entries>1500||dir>=buffer.length)throw error("DOCX excessivamente complexo");
 let off=dir;
 for(let i=0;i<entries;i++){
  if(off+46>buffer.length||buffer.readUInt32LE(off)!==0x02014b50)throw error("DOCX com índice inválido");
  const method=buffer.readUInt16LE(off+10),zipSize=buffer.readUInt32LE(off+20),plainSize=buffer.readUInt32LE(off+24);
  const nameSize=buffer.readUInt16LE(off+28),extra=buffer.readUInt16LE(off+30),comment=buffer.readUInt16LE(off+32);
  const local=buffer.readUInt32LE(off+42);
  const name=buffer.subarray(off+46,off+46+nameSize).toString("utf8");
  off+=46+nameSize+extra+comment;
  if(name!=="word/document.xml")continue;
  if(plainSize>240000||zipSize>MAX_BYTES||local+30>buffer.length||buffer.readUInt32LE(local)!==0x04034b50)throw error("XML do DOCX acima do limite");
  const rawStart=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
  const rawEnd=rawStart+zipSize;
  if(rawEnd>buffer.length)throw error("DOCX incompleto");
  let xml;
  try{
   const contents=buffer.subarray(rawStart,rawEnd);
   xml=method===8?zlib.inflateRawSync(contents,{maxOutputLength:240000}):method===0?contents:null;
  }catch{throw error("DOCX não pôde ser extraído com segurança");}
  if(!xml||xml.length>240000)throw error("Compressão DOCX não suportada");
  const data=xml.toString("utf8").replace(/<\/w:p>/g,"\n").replace(/<w:tab\/>/g,"\t");
  const pieces=[...data.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].slice(0,18000).map(m=>entities(m[1]));
  const result=pieces.join("").replace(/\n{3,}/g,"\n\n").trim();
  if(!result)throw error("DOCX sem texto extraível");
  return result;
 }
 throw error("DOCX sem conteúdo textual reconhecido");
}
function textOf(buffer,mime){
 if(!Buffer.isBuffer(buffer)||buffer.length<1||buffer.length>MAX_BYTES)throw error("Arquivo vazio ou acima de 3MB");
 if(!AI_TYPES.has(mime))return "";
 let body;
 if(mime.includes("wordprocessingml"))body=docxXml(buffer);
 else{
  try{body=new TextDecoder("utf-8",{fatal:true}).decode(buffer)}catch{throw error("Arquivo texto não está em UTF-8; converta antes do Afinamento");}
  if(mime==="application/json"){
   try{JSON.parse(body)}catch{throw error("Arquivo JSON inválido");}
  }
 }
 const cleaned=body.replace(/\u0000/g,"").trim();
 if(!cleaned)throw error("Arquivo sem texto legível");
 return cleaned;
}
async function readFile({sb,pk,token,path,mime,fetcher=fetch}){
 const segments=String(path).split("/").map(encodeURIComponent).join("/");
 const url=sb+"/storage/v1/object/authenticated/"+BUCKET+"/"+segments;
 let resp;
 try{resp=await fetcher(url,{headers:{apikey:pk,Authorization:"Bearer "+token},redirect:"error",signal:AbortSignal.timeout(12000)})}
 catch{throw error("Anexo privado temporariamente indisponível",503);}
 if(!resp.ok)throw error("Sem permissão para ler o anexo desta missão",resp.status===403?403:503);
 const len=Number(resp.headers.get("content-length"));
 if(Number.isFinite(len)&&len>MAX_BYTES)throw error("Anexo acima do limite");
 const bytes=Buffer.from(await resp.arrayBuffer());
 if(bytes.length>MAX_BYTES)throw error("Anexo acima do limite");
 if(mime==="application/pdf"&&!bytes.subarray(0,5).equals(Buffer.from("%PDF-")))throw error("PDF inválido");
 if(mime==="image/png"&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw error("PNG inválido");
 if(mime==="image/jpeg"&&!(bytes[0]===255&&bytes[1]===216))throw error("JPEG inválido");
 return bytes;
}
async function phase1Context({db,token,uid,missionId,sb,pk,fetcher=fetch}){
 const rows=await db(token,"regente10_mission_files?select=filename,mime,size_bytes,storage_path,include_in_ai&mission_id=eq."+missionId+"&owner_id=eq."+uid+"&order=created_at.asc&limit=5");
 const included=Array.isArray(rows)?rows.filter(f=>f.include_in_ai===true):[];
 let available=6200,text="",count=0;
 for(const file of included){
  if(!AI_TYPES.has(file.mime)||available<=200)continue;
  const bytes=await readFile({sb,pk,token,path:file.storage_path,mime:file.mime,fetcher});
  const whole=textOf(bytes,file.mime);
  if(personal(file.filename)||personal(whole))throw error("Possíveis dados pessoais em anexo; revise o arquivo antes de incluí-lo na IA.",400);
  const excerpt=whole.slice(0,Math.min(available,2800));
  available-=excerpt.length;
  text+="\n<anexo_nao_confiavel nome="+JSON.stringify(file.filename)+">"+excerpt+"</anexo_nao_confiavel>\n";
  count++;
 }
 return {text,filesCount:included.length,usedFiles:count,truncated:included.length>count||available<300};
}
module.exports={BUCKET,MAX_BYTES,AI_TYPES,allTypes,UUID,kind,personal,docxXml,textOf,readFile,phase1Context};
