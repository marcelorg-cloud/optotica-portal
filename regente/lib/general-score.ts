/**
 * Regente v0.8 — deterministic extraction of instrumental parts from one
 * canonical general score. No model, secret, DB access or external side effect.
 *
 * A score is a versioned source of instructions, not a runtime permission grant.
 * Runtime Auth/Master/RLS, policy and adapter-state checks remain mandatory.
 */
import { COORDINATOR_ROLES } from "./cooperative-orchestra.ts";

export type ScoreStatus = "draft" | "approved" | "superseded";
export type DataClassification = "public" | "internal_redacted" | "restricted";
export type ActorPlane = "coordination" | "network";
export type ActorSpec = {
  id: string;
  plane: ActorPlane;
  role: string;
  responsibilities: string[];
  readsFrom: string[];
  communicatesWith: string[];
  knowledgeAccess: DataClassification;
};
export type InstrumentSpec = {
  id: string;
  service: string;
  purpose: string;
  adapter: "implemented" | "proposed" | "not_verified";
  // This is a document registry, not a live health check.
};
export type ScoreRule = {
  id: string; text: string; required: boolean;
  status: "approved" | "draft";
};
export type WorkReference = {
  id: string; name: string; purpose: string;
  audience: string[];
  dataClass: DataClassification;
  status: ScoreStatus;
  sourceId: string;
};
export type GeneralScore = {
  id: string; version: string; status: ScoreStatus;
  institution: string; intent: string;
  rules: ScoreRule[];
  works: WorkReference[];
  actors: ActorSpec[];
  instruments: InstrumentSpec[];
};
const idPattern=/^[a-zA-Z0-9_-]{1,80}$/;
const allowedClass: DataClassification[]=["public","internal_redacted","restricted"];
const classRank=(name: DataClassification)=>allowedClass.indexOf(name);
function unique<T>(values: T[]) { return new Set(values).size===values.length; }

export function validateGeneralScore(score: GeneralScore) {
  if (!idPattern.test(score.id) || !/^\d+\.\d+\.\d+$/.test(score.version) ||
      !["draft","approved","superseded"].includes(score.status) ||
      !score.institution.trim() || !score.intent.trim()) throw new Error("invalid_general_score");
  if (!score.rules.length || !score.actors.length) throw new Error("missing_constitution_or_actors");
  if (!unique(score.rules.map(rule=>rule.id)) || !unique(score.actors.map(actor=>actor.id)) ||
      !unique(score.instruments.map(instrument=>instrument.id)) || !unique(score.works.map(work=>work.id))) {
    throw new Error("duplicate_score_id");
  }
  for (const actor of score.actors) {
    if (!idPattern.test(actor.id) || !actor.responsibilities.length ||
        !allowedClass.includes(actor.knowledgeAccess) ||
        !actor.communicatesWith.every(id=>id!==actor.id && score.actors.some(other=>other.id===id))) {
      throw new Error("invalid_actor_contract");
    }
  }
  if (score.rules.some(rule=>!idPattern.test(rule.id) || !rule.text.trim())) throw new Error("invalid_score_rule");
  if (score.works.some(work=>!idPattern.test(work.id) || !work.sourceId.trim() ||
      !allowedClass.includes(work.dataClass) ||
      !work.audience.every(id=>id==="all"||score.actors.some(actor=>actor.id===id)))) {
    throw new Error("invalid_work_reference");
  }
  if (score.instruments.some(instrument=>!idPattern.test(instrument.id) || !instrument.service.trim())) {
    throw new Error("invalid_instrument_registry");
  }
  return true;
}

/**
 * Each actor receives exactly the shared approved constitutional rules,
 * its own responsibilities, and authorized work references.
 * Full instrumentation is given as an inventory, never operational proof.
 */
export function extractInstrumentalPart(
  score: GeneralScore,
  actorId: string,
  classification: DataClassification = "public",
) {
  validateGeneralScore(score);
  const actor=score.actors.find(item=>item.id===actorId);
  if (!actor) throw new Error("actor_not_in_general_score");
  if (classRank(classification)>classRank(actor.knowledgeAccess)) throw new Error("knowledge_access_denied");
  const effective=score.status==="approved";
  const mandatory=score.rules.filter(rule=>rule.required);
  if (effective && mandatory.some(rule=>rule.status!=="approved")) throw new Error("unapproved_mandatory_rule");
  const approvedRules=score.rules.filter(rule=>rule.status==="approved");
  return {
    source: { scoreId:score.id, version:score.version, status:score.status },
    validity: effective ? "canonical" as const : "draft_review_only" as const,
    actor: { id:actor.id, plane:actor.plane, role:actor.role },
    inheritedRules: effective ? approvedRules.map(rule=>({id:rule.id,text:rule.text})) : [],
    responsibilities:actor.responsibilities.slice(),
    readsFrom:actor.readsFrom.slice(),
    peers:actor.communicatesWith.slice(),
    works:effective ? score.works.filter(work=>work.status==="approved" &&
      classRank(work.dataClass)<=classRank(classification) &&
      (work.audience.includes("all")||work.audience.includes(actorId)))
      .map(work=>({id:work.id,name:work.name,purpose:work.purpose,sourceId:work.sourceId})) : [],
    instrumentRegistry:score.instruments.map(item=>({
      id:item.id,service:item.service,purpose:item.purpose,
      declaredAdapter:item.adapter,operational:false as const,
    })),
    executionAuthority:false as const,
    approvalRequiredForEffects:true as const,
    note: effective
      ? "Partitura versionada para consulta; estado do adapter e autorização devem ser verificados no runtime."
      : "Minuta para revisão; não autoriza configuração, interpretação como política ou execução.",
  };
}

export const NETWORK_INSTRUMENTAL_PARTS: ActorSpec[] = [
  { id:"A1",plane:"network",role:"Engenharia Optótica",responsibilities:["Produzir output de engenharia somente mediante adapter e autorização."],readsFrom:["general_score","work_score","mission_score"],communicatesWith:["orquestrador","regente","auditor_harmonia"],knowledgeAccess:"internal_redacted" },
  { id:"A2",plane:"network",role:"Produto Optótica",responsibilities:["Produzir output de produto somente mediante adapter e autorização."],readsFrom:["general_score","work_score","mission_score"],communicatesWith:["orquestrador","regente","auditor_harmonia"],knowledgeAccess:"internal_redacted" },
  { id:"A3",plane:"network",role:"Conteúdo ENSAVIM",responsibilities:["Produzir conteúdo autorizado conforme a obra e sua missão."],readsFrom:["general_score","work_score","mission_score"],communicatesWith:["orquestrador","regente","auditor_harmonia"],knowledgeAccess:"internal_redacted" },
  { id:"A4",plane:"network",role:"Revisor OpenAI",responsibilities:["Produzir revisão independente sem conceder aprovação."],readsFrom:["general_score","work_score","mission_score"],communicatesWith:["regente","auditor_harmonia"],knowledgeAccess:"internal_redacted" },
  { id:"A6",plane:"network",role:"Parecer Claude manual",responsibilities:["Importar parecer humano externo; sem API Claude automática comprovada."],readsFrom:["general_score","work_score","mission_score"],communicatesWith:["regente","auditor_harmonia"],knowledgeAccess:"internal_redacted" },
];
export const ORGANIZER_INSTRUMENTAL_PARTS: ActorSpec[] = COORDINATOR_ROLES.map(role=>({
  id:role.id,plane:"coordination",role:role.name,
  responsibilities:[role.responsibility],
  readsFrom:["general_score","work_score","mission_score"],
  communicatesWith:COORDINATOR_ROLES.filter(peer=>peer.id!==role.id).map(peer=>peer.id),
  knowledgeAccess:"internal_redacted",
}));

/**
 * Deliberately DRAFT until the institution approves its official intent,
 * values, public and scope. Executing agents must not treat it as live policy.
 */
export const GENERAL_SCORE_DRAFT: GeneralScore = {
  id:"goraieb-instituto-visao",version:"0.1.0",status:"draft",
  institution:"Goraieb Instituto da Visão",
  intent:"Proposta: contribuir para a transformação da óptica e da optometria no Brasil integrando pesquisa científica, educação, tecnologia de ponta, empreendedorismo e cooperação multidisciplinar.",
  rules:[
    {id:"purpose",text:"Contornos preservam resultados indispensáveis e o propósito aprovado da obra.",required:true,status:"draft"},
    {id:"cooperation",text:"Organizadores independentes coordenam; somente executores autorizados geram outputs.",required:true,status:"draft"},
    {id:"privacy",text:"Proteger dados pessoais e clínicos; sem política e autorização, não compartilhar.",required:true,status:"draft"},
    {id:"provenance",text:"Não converter opiniões em fatos ou entregas sem evidência verificável.",required:true,status:"draft"},
    {id:"safe_detours",text:"Não contornar segurança, Auth, RLS, limites e gates humanos.",required:true,status:"draft"},
  ],
  works:[
    {id:"optotica",name:"Optótica",purpose:"Plataforma de integração do setor óptico-optométrico, com foco em inovação tecnológica e empreendedorismo.",
      audience:["all"],dataClass:"public",status:"draft",sourceId:"v0.8-partitura-geral.md"},
    {id:"ensavim",name:"ENSAVIM",purpose:"Encontro multidisciplinar de saúde visual, com foco educacional, teórico, científico e de integração profissional.",
      audience:["all"],dataClass:"public",status:"draft",sourceId:"v0.8-partitura-geral.md"},
  ],
  actors:[...ORGANIZER_INSTRUMENTAL_PARTS,...NETWORK_INSTRUMENTAL_PARTS],
  instruments:[
    {id:"A1",service:"OpenAI Agents SDK",purpose:"Engenharia Optótica",adapter:"implemented"},
    {id:"A2",service:"OpenAI Agents SDK",purpose:"Produto Optótica",adapter:"implemented"},
    {id:"A3",service:"OpenAI Agents SDK",purpose:"Conteúdo ENSAVIM",adapter:"implemented"},
    {id:"A4",service:"OpenAI Agents SDK",purpose:"Revisão independente",adapter:"implemented"},
    {id:"A5",service:"Local / Supabase",purpose:"Preflight determinístico",adapter:"implemented"},
    {id:"A6",service:"Claude revisão humana",purpose:"Parecer externo manual",adapter:"proposed"},
    {id:"F1",service:"GitHub",purpose:"Repositório e commits; executor direto no Regente não comprovado",adapter:"not_verified"},
    {id:"F2",service:"Vercel",purpose:"Deployments e runtime; executor de fases não comprovado",adapter:"not_verified"},
    {id:"F3",service:"Supabase",purpose:"Estado, autenticação e preflight local",adapter:"implemented"},
    {id:"F4",service:"Replicate",purpose:"Tratamento de imagens",adapter:"not_verified"},
    {id:"F5",service:"Canva",purpose:"Prova virtual; adapter próprio não comprovado",adapter:"not_verified"},
    {id:"F6",service:"Canva via Portal",purpose:"Criativos e inspeção",adapter:"implemented"},
    {id:"F7",service:"HeyGen",purpose:"Produção de vídeo",adapter:"not_verified"},
    {id:"F8",service:"RapidAPI",purpose:"Catálogo e consultas",adapter:"not_verified"},
    {id:"F9",service:"Meta / WhatsApp",purpose:"Mensagens e anúncios; adapter não comprovado",adapter:"not_verified"},
    {id:"F10",service:"Resend",purpose:"E-mail",adapter:"not_verified"},
    {id:"F11",service:"Cloudflare",purpose:"Rede, domínio e DNS",adapter:"not_verified"},
    {id:"F12",service:"Google Drive",purpose:"Biblioteca de arquivos; OAuth Regente indisponível",adapter:"not_verified"},
    {id:"F13",service:"Google Docs",purpose:"Documentação; OAuth Regente indisponível",adapter:"not_verified"},
    {id:"F14",service:"Google Planilhas",purpose:"Matriz da rede",adapter:"not_verified"},
  ],
};
