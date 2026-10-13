"use strict";
const fs=require("node:fs"),path=require("node:path");
const {cookieToken,verifyMaster,clearCookie,noStore}=require("../lib/master-session.js");
const VIEWS={index:"index.html",network:"network.html",governance:"governance.html",budget:"budget.html"};
module.exports=async(req,res)=>{
 noStore(res);
 if(!["GET","HEAD"].includes(req.method))return res.status(405).send("Método não permitido.");
 const view=req.query?.view||"index";
 if(typeof view!=="string"||!Object.hasOwn(VIEWS,view))return res.status(404).send("Página não encontrada.");
 const token=cookieToken(req);
 try{await verifyMaster(token);}catch(e){
  if(e.status===401||e.status===403){clearCookie(res);res.setHeader("Location","/login");return res.status(303).send("");}
  return res.status(503).send("Autenticação temporariamente indisponível. Tente novamente.");
 }
 try{
  let html=fs.readFileSync(path.join(__dirname,"..",VIEWS[view]),"utf8");
  // Existing APIs use the signed-in user's Bearer token. Never inject provider credentials.
  html=html.replace("<body>","<body><script>sessionStorage.setItem(\"regente10_token\","+JSON.stringify(token)+");</script>");
  html=html.replace("</body>",'<script src="/session-client.js"></script></body>');
  res.setHeader("Content-Type","text/html; charset=utf-8");
  return res.status(200).send(req.method==="HEAD"?"":html);
 }catch{return res.status(503).send("Painel temporariamente indisponível.");}
};
