"use strict";
const crypto=require("node:crypto"),Ajv=require("ajv"),formats=require("ajv-formats");
const error=(code,status=409)=>Object.assign(new Error(code),{code,status});
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PROJECTS=["optotica","ensavim","born-robot","instituto-governanca"];
const credentialField=/^(?:__proto__|constructor|prototype|.*(?:password|secret|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|oauth[_-]?token|token|bearer|custom[_-]?auth|auth[_-]?data).*)$/i;
const elevatedSurface=/(?:^|_)(?:PROXY|GRAPHQL|SQL|INVOKE|BASH|TERMINAL|SHELL|SCRIPT|COMMAND|SECRETS?|TOKENS?|KEYS?|ENV|ENVIRONMENT|ENVIRONMENTS|DEPLOY|DEPLOYMENT|DEPLOYMENTS|REDEPLOY|AUTH|PASSWORD|PERMISSIONS?|ADMIN|ROLES?|MEMBERSHIP|CREDENTIALS?|PAYMENTS?|BANK|PURCHASE|BILLING)(?:_|$)|(?:EXECUTE|RUN)_(?:CODE|QUERY)|(?:CUSTOM|HTTP|API)_(?:REQUEST|CALL)|(?:CREATE|DELETE|REMOVE|UPDATE|ADD)_(?:A_)?(?:USER|TEAM|ACCOUNT|ORGANIZATION|MEMBER|PROJECT)(?:_|$)/i;
function assertToolLevel(tool){if(elevatedSurface.test(tool.slug))throw error("privileged_route_requires_separate_s00_review");return tool;}
const targetFields=new Set(["repo","repo_name","repository","project_id","projectid","folder_id","parent_id","document_id","documentid","spreadsheet_id","spreadsheetid","drive_id","file_id","page_id","database_id","channel_id","workspace_id","calendar_id","message_id","ad_account_id","site_id","domain","model_id","voice_id","url"]);
function assertDestination(args){
 const found=[];
 function visit(v){if(!v||typeof v!=="object")return;for(const [k,x] of Object.entries(v)){
  if(targetFields.has(k.toLowerCase())&&typeof x==="string"&&x.trim().length>=3&&!/^(?:all|root|me|primary|default|\*)$/i.test(x.trim())){
   if(k.toLowerCase()==="url"){let u;try{u=new URL(x)}catch{continue;}if(u.protocol!=="https:"||u.username||u.password||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname))continue;}
   found.push(k);
  }
  visit(x);
 }}visit(args);
 if(!found.length)throw error("explicit_project_destination_required");return args;
}
function canonical(v,depth=0){
 if(depth>20)throw error("input_too_deep",400);
 if(v===null||typeof v==="boolean"||typeof v==="string")return JSON.stringify(v);
 if(typeof v==="number"&&Number.isFinite(v))return JSON.stringify(v);
 if(Array.isArray(v))return "["+v.map(x=>canonical(x,depth+1)).join(",")+"]";
 if(v&&typeof v==="object"&&[Object.prototype,null].includes(Object.getPrototypeOf(v)))return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k],depth+1)).join(",")+"}";
 throw error("invalid_json",400);
}
const hash=v=>crypto.createHash("sha256").update(canonical(v)).digest("hex");
function argumentsSafe(v,depth=0){
 if(depth>15)throw error("input_too_deep",400);
 if(v&&typeof v==="object")for(const [k,x] of Object.entries(v)){if(credentialField.test(k))throw error("credentials_forbidden",400);argumentsSafe(x,depth+1);}
 if(typeof v==="string"&&([process.env.COMPOSIO_API_KEY,process.env.REGENTE_GATEWAY_KEY,process.env.OPENAI_API_KEY].filter(Boolean).some(s=>v.includes(s))||/\b(?:ak_|sk_live_|sk_test_|sb_secret_)[A-Za-z0-9_-]{12,}/.test(v)||/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(v)))throw error("credentials_forbidden",400);
 if(depth===0&&(!v||Array.isArray(v)||typeof v!=="object"||Buffer.byteLength(canonical(v))>64000))throw error("invalid_arguments",400);
 return v;
}
function schemaFor(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw error("unsupported_schema");
 if(input.type==="object"||input.properties||input.allOf||input.anyOf||input.oneOf)return input;
 const properties={},required=[];
 for(const [k,v] of Object.entries(input)){
  if(!v||typeof v!=="object"||credentialField.test(k))throw error("unsupported_schema");
  const {required:isRequired,example,...schema}=v;
  if(typeof isRequired!=="boolean"&&isRequired!==undefined)throw error("unsupported_schema");
  properties[k]=schema;if(isRequired)required.push(k);
 }
 return {type:"object",properties,required,additionalProperties:false};
}
function validateArguments(schema,args){
 argumentsSafe(args);
 const ajv=new Ajv({strict:true,strictRequired:false,allowUnionTypes:true,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false});formats(ajv);
 let validate;try{validate=ajv.compile(schema)}catch{throw error("unsupported_schema")}
 if(!validate(args))throw error("arguments_schema_mismatch",400);return args;
}
function normalizeTool(t,toolkit){
 if(t?.toolkit?.slug!==toolkit||!/^[A-Z0-9_]{1,150}$/.test(t.slug||"")||!/^[a-zA-Z0-9_.-]{1,80}$/.test(t.version||"")||t.version==="latest"||t.is_deprecated===true)throw error("unsupported_tool_contract");
 const schema=schemaFor(t.input_parameters);
 const contract={slug:t.slug,toolkit,version:t.version,schema,scopes:t.scope_requirements||t.scopes||[],noAuth:t.no_auth===true};
 return {slug:t.slug,version:t.version,name:String(t.name||t.slug).slice(0,160),description:String(t.description||"").slice(0,2000),schema,contractHash:hash(contract),tags:Array.isArray(t.tags)?t.tags.filter(x=>typeof x==="string").slice(0,30):[],noAuth:t.no_auth===true,pricing:t.instant?.price?{surface:"instant_only_not_enabled",published:t.instant.price}:null};
}
function linkKey(){const key=process.env.REGENTE_GATEWAY_KEY;if(!key||key.length<32)throw error("gateway_not_configured",503);return crypto.createHash("sha256").update(key).digest();}
const aad=b=>Buffer.from(b.project_id+":"+b.id+":"+b.attempt_id);
function safeLink(url){let u;try{u=new URL(url)}catch{throw error("invalid_connect_link")}
 if(u.protocol!=="https:"||u.username||u.password||u.port||!["connect.composio.dev","app.composio.dev","backend.composio.dev"].includes(u.hostname))throw error("invalid_connect_link");return u.href;
}
function encryptLink(url,b){const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",linkKey(),iv);c.setAAD(aad(b));const data=Buffer.concat([c.update(safeLink(url),"utf8"),c.final()]);return [iv,c.getAuthTag(),data].map(x=>x.toString("base64url")).join(".");}
function decryptLink(cipher,b){const [iv,tag,data]=cipher.split(".").map(x=>Buffer.from(x,"base64url")),c=crypto.createDecipheriv("aes-256-gcm",linkKey(),iv);c.setAAD(aad(b));c.setAuthTag(tag);return safeLink(Buffer.concat([c.update(data),c.final()]).toString("utf8"));}
function sanitizeResult(v,depth=0){
 if(depth>8)return "[limited]";
 if(typeof v==="string"){
  if([process.env.COMPOSIO_API_KEY,process.env.REGENTE_GATEWAY_KEY].filter(Boolean).some(s=>v.includes(s))||/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(v)||/\b(?:ak_|sk_live_|sb_secret_)[A-Za-z0-9_-]{12,}/.test(v))return "[redacted]";
  return v.slice(0,4000);
 }
 if(Array.isArray(v))return v.slice(0,50).map(x=>sanitizeResult(x,depth+1));
 if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).filter(([k])=>!credentialField.test(k)&&!/^headers$|^cookies$|^state$/i.test(k)).slice(0,60).map(([k,x])=>[k,sanitizeResult(x,depth+1)]));
 return ["boolean","number"].includes(typeof v)?v:null;
}
module.exports={error,UUID,PROJECTS,hash,canonical,argumentsSafe,normalizeTool,validateArguments,encryptLink,decryptLink,safeLink,sanitizeResult,assertToolLevel,assertDestination};
