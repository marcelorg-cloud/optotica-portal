"use strict";
const COOKIE="__Host-regente10_master",UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const problem=(status,message)=>Object.assign(new Error(message),{status});
function validToken(token){return typeof token==="string"&&token.length<=3800&&/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);}
function cookieToken(req){const entries=String(req.headers.cookie||"").split(";").map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+"="));if(entries.length!==1)return "";const token=entries[0].slice(COOKIE.length+1);return validToken(token)?token:"";}
function sameOrigin(req){try{return new URL(req.headers.origin).origin==="https://"+req.headers.host}catch{return false}}
function noStore(res){res.setHeader("Cache-Control","private, no-store, max-age=0");res.setHeader("Vary","Cookie");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","no-referrer");}
function clearCookie(res){res.setHeader("Set-Cookie",COOKIE+"=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0");}
async function verifyMaster(token,{fetcher=fetch}={}){
 if(!validToken(token))throw problem(401,"Faça login como Master.");
 const sb=process.env.SUPABASE_URL,pk=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!sb||!pk)throw problem(503,"Autenticação indisponível.");
 const opt={headers:{apikey:pk,Authorization:"Bearer "+token,Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(5000)};
 try{
  const u=await fetcher(sb+"/auth/v1/user",opt);
  if(!u.ok)throw problem(u.status===401||u.status===403?401:503,"Sessão inválida ou indisponível.");
  const user=await u.json();if(!UUID.test(user?.id||""))throw problem(401,"Sessão inválida.");
  const a=await fetcher(sb+"/rest/v1/system_admins?select=user_id&active=eq.true&user_id=eq."+user.id+"&limit=1",opt);
  if(!a.ok)throw problem(503,"Autorização indisponível.");
  const rows=await a.json();if(!Array.isArray(rows)||rows.length!==1||rows[0].user_id!==user.id)throw problem(403,"Somente Master ativo pode entrar no painel.");
  return user.id;
 }catch(e){if(e.status)throw e;throw problem(503,"Autenticação indisponível.");}
}
function setCookie(res,token){
 let exp;try{exp=JSON.parse(Buffer.from(token.split(".")[1],"base64url")).exp}catch{}
 const age=Math.min(3600,Math.floor(Number(exp)-Date.now()/1000));
 if(!Number.isFinite(age)||age<=0)throw problem(401,"Sessão expirada.");
 res.setHeader("Set-Cookie",COOKIE+"="+token+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age="+age);
}
module.exports={cookieToken,verifyMaster,setCookie,clearCookie,sameOrigin,noStore,validToken};
