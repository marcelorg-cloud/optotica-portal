import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { COORDINATOR_ROLES, COOPERATION_CHARTER, type CoordinatorId, type CoordinationNote } from "./cooperative-orchestra";

/**
 * Independent organizational agents. These agents have no tools and cannot
 * create mission deliverables, publish, mutate the database or approve work.
 * Calls are not connected to any production workflow in this foundation.
 */
const Report = z.object({
  conclusion: z.string().min(1).max(1800),
  evidence: z.array(z.string().min(1).max(350)).min(1).max(5),
  disagreement: z.string().max(900).nullable(),
  recommendedNextAction: z.string().min(1).max(500),
});

export function createOrganizer(id: CoordinatorId) {
  const role = COORDINATOR_ROLES.find(item=>item.id===id);
  if (!role) throw new Error("unknown_organizer");
  return new Agent({
    name: `Organizador independente — ${role.name}`,
    model: process.env.REGENT_COORDINATOR_MODEL || process.env.REGENT_MODEL || "gpt-5.6-sol",
    instructions: [
      "Você atua apenas no plano de COORDENAÇÃO. Não produz artefatos finais nem executa ferramentas.",
      "Sua responsabilidade específica: " + role.responsibility + ".",
      "Você é um par cooperativo dos demais organizadores, não subordinado a um agente central.",
      "Baseie pareceres somente nas evidências recebidas; explicite lacunas, riscos e dissonâncias.",
      "Não invente acessos, chamadas, testes, autorizações, documentação ou execução.",
      "Não solicite nem exponha segredos ou dados pessoais. Sem evidências suficientes, sinalize a limitação.",
      "Uma recomendação nunca concede permissão para executar, alterar, publicar ou gastar.",
      "Constituição operacional:\n" + COOPERATION_CHARTER.join("\n"),
    ].join("\n"),
    outputType: Report,
  });
}

export type OrganizerBrief = {
  missionId: string;
  scoreVersion: string;
  objective: string;
  focus: string;
  // Only approved, minimized non-sensitive summaries. Never pass patient records.
  sanitizedContext: string;
  knowledgeReferences: string[];
  dataClass: "public" | "internal_redacted";
};

export async function askIndependentOrganizer(id: CoordinatorId, brief: OrganizerBrief): Promise<CoordinationNote & { recommendedNextAction: string }> {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("openai_not_configured");
  if (!brief.missionId || !brief.scoreVersion || !brief.objective || !brief.focus ||
      !["public","internal_redacted"].includes(brief.dataClass) ||
      brief.objective.length>2500 || brief.sanitizedContext.length>5000 ||
      brief.knowledgeReferences.length>16) throw new Error("organizer_brief_invalid");
  const response = await run(createOrganizer(id), JSON.stringify(brief), {
    maxTurns: 1, signal: AbortSignal.timeout(45_000),
  });
  const result = response.finalOutput;
  if (!result) throw new Error("organizer_output_missing");
  return {
    organizer: id, missionId: brief.missionId, scoreVersion: brief.scoreVersion,
    focus: brief.focus, conclusion: result.conclusion, evidence: result.evidence,
    disagreement: result.disagreement || undefined,
    recommendedNextAction: result.recommendedNextAction,
  };
}

/**
 * Explicit, bounded concurrent review for a future authenticated coordinator.
 * Do not call from the public UI until Master approval, cost limits and data
 * minimization gates have been implemented and tested.
 */
export async function reviewWithOrganizers(
  ids: CoordinatorId[], brief: OrganizerBrief,
): Promise<Array<CoordinationNote & { recommendedNextAction: string }>> {
  if (!ids.length || ids.length>3 || new Set(ids).size!==ids.length) throw new Error("organizer_call_budget_exceeded");
  const results: Array<CoordinationNote & { recommendedNextAction: string }> = [];
  for (let offset=0;offset<ids.length;offset+=2) {
    results.push(...await Promise.all(ids.slice(offset,offset+2).map(id=>askIndependentOrganizer(id,brief))));
  }
  return results;
}
