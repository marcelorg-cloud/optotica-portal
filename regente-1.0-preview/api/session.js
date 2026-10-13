"use strict";
const {cookieToken,verifyMaster,setCookie,clearCookie,sameOrigin,noStore}=require("../lib/master-session.js");
module.exports=async(req,res)=>{
 noStore(res);
 if(!["GET","POST","DELETE"].includes(req.method))return res.status(405).json({error:"Método não permitido."});
 if(req.method!=="GET"&&!sameOrigin(req))return res.status(403).json({error:"Origem não autorizada."});
 if(req.method==="DELETE"){clearCookie(res);return res.status(200).json({signedOut:true});}
 const token=req.method==="POST"?String(req.headers.authorization||"").match(/^Bearer ([\w.-]+)$/)?.[1]:cookieToken(req);
 try{await verifyMaster(token);if(req.method==="POST")setCookie(res,token);return res.status(200).json({master:true});}
 catch(e){clearCookie(res);return res.status(e.status||503).json({error:e.status?e.message:"Autenticação indisponível."});}
};
