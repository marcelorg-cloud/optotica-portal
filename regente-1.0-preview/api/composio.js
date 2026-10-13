"use strict";
const {inventory}=require("../lib/composio-readonly.js");
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const send=(r,n,v)=>r.status(n).json(v);
async function master(req){
 const sb=process.env.SUPABASE_URL,pk=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!sb||!pk)throw Object.assign(new Error("Autenticação indisponível."),{status:503});
 const token=String(req.headers.authorization||"").match(/^Bearer ([-.\w]+)$/)?.[1];
 if(!token)throw Object.assign(new Error("Faça login como Master."),{status:401});
 const headers={apikey:pk,Authorization:"Bearer "+token,Accept:"application/json"};
 const opt={headers,redirect:"error",signal:AbortSignal.timeout(5000)};
 const u=await fetch(sb+"/auth/v1/user",opt);
 if(!u.ok)throw Object.assign(new Error("Sessão expirada."),{status:401});
 const identity=await u.json();
 if(!UUID.test(identity?.id||""))throw Object.assign(new Error("Identidade inválida."),{status:401});
 const a=await fetch(sb+"/rest/v1/system_admins?select=user_id&active=eq.true&user_id=eq."+identity.id+"&limit=1",opt);
 if(!a.ok)throw Object.assign(new Error("Autorização indisponível."),{status:503});
 const rows=await a.json();
 if(!Array.isArray(rows)||rows.length!==1||rows[0].user_id!==identity.id)throw Object.assign(new Error("Somente Master autorizado."),{status:403});
 const c=await fetch(sb+"/rest/v1/regente10_controls?select=emergency_stop&owner_id=eq."+identity.id+"&limit=1",opt);
 if(!c.ok)throw Object.assign(new Error("Controle de emergência indisponível."),{status:503});
 const controls=await c.json();
 if(!Array.isArray(controls))throw Object.assign(new Error("Controle de emergência indisponível."),{status:503});
 if(controls[0]?.emergency_stop===true)throw Object.assign(new Error("Parada de emergência ativa."),{status:423});
}
module.exports=async(req,res)=>{
 res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","no-referrer");
 if(req.method!=="GET")return send(res,405,{error:"Apenas consulta de inventário disponível."});
 if(Object.keys(req.query||{}).some(k=>k!=="action")||![undefined,"status"].includes(req.query?.action))return send(res,400,{error:"Consulta não permitida."});
 try{await master(req);return send(res,200,await inventory());}
 catch(e){return send(res,e.status||503,{error:e.status?e.message:"Consulta temporariamente indisponível.",code:e.code||"access_unavailable",externalWritesEnabled:false,toolExecutionEnabled:false});}
};
