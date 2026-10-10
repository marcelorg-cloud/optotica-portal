import { Agent, run } from "@openai/agents";
import { z } from "zod";
import type { PipelineStep } from "./adapters";
import { guardianSpecialistInstructions, loadGuardianSourceSnapshot } from "./guardian-context";
import { redactSecrets } from "./phase-control";

export type RecoveryArtifact = { step: number; node: string; output: unknown };

const RecoveryDecision = z.object({
  diagnosis: z.string(),
  errorClass: z.enum(["transient", "timeout", "access", "payload", "adapter", "code", "unknown"]),
  sameErrorLikely: z.boolean(),
  canRetry: z.boolean(),
  retryStrategy: z.enum(["same", "rewrite_input", "reduce_scope", "none"]),
  revisedAction: z.string().nullable(),
  revisedInput: z.string().nullable(),
  revisedExpectedOutput: z.string().nullable(),
  reduceVariantsTo: z.number().int().min(1).max(3).nullable(),
  codeChangeRequired: z.boolean(),
  patchProposal: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  operatorNote: z.string(),
});

export type RecoveryDecisionOutput = z.infer<typeof RecoveryDecision>;

const IndependentRecoveryReview = z.object({
  review: z.string().min(1),
});

function normalizeError(error: unknown) {
  const message = redactSecrets(error instanceof Error ? error.message : String(error || "Unknown error"));
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, "<uuid>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/https?:\/\/[^\s]+/g, "<url>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

export function errorFingerprint(error: unknown) {
  return normalizeError(error).toLowerCase();
}
function artifactsText(artifacts: RecoveryArtifact[]) {
  if (!artifacts.length) return "Nenhum output anterior.";
  return redactSecrets(artifacts.slice(-6).map((item) =>
    `ETAPA ${item.step} / ${item.node}\n${typeof item.output === "string" ? item.output : JSON.stringify(item.output)}`,
  ).join("\n\n")).slice(0, 12000);
}
async function sourceContext(node: string) {
  const sources = await loadGuardianSourceSnapshot();
  const required = new Set([
    "regente/lib/phase-control.ts", "regente/lib/phase-executor.ts", "regente/lib/orchestra-health.ts",
    "regente/app/api/tasks/[taskId]/execute/route.ts", "regente/app/api/tasks/[taskId]/decision/route.ts",
    "regente/lib/adapters.ts", ...(node === "F6" ? ["app/api/internal/regente/canva/route.ts"] : []),
  ]);
  return sources.filter((source) => required.has(source.path)).map((source) =>
    `### ${source.path} @ ${source.commit || "commit não comprovado"} / ${source.state}\n${source.content || "Fonte indisponível: não presumir seu conteúdo."}`,
  ).join("\n\n").slice(0, 62000);
}
export async function analyzeRecovery(input: {
  objective: string;
  taskTitle: string;
  step: PipelineStep;
  node: string;
  error: unknown;
  artifacts: RecoveryArtifact[];
  previousRecovery?: RecoveryDecisionOutput | null;
  independentReview?: string | null;
  recurrence: number;
}) {
  const agent = new Agent({
    name: "Guardião externo OpenAI — Engenharia do Regente",
    model: process.env.REGENT_RECOVERY_MODEL || "gpt-5.6-sol",
    modelSettings: {
      reasoning: { effort: "high" },
      text: { verbosity: "medium" },
    },
    instructions: [
      guardianSpecialistInstructions("openai"),
      "Você é o engenheiro de recuperação do Regente Optótica.",
      "Sua função é diagnosticar falhas de execução de pipeline e propor a menor correção segura.",
      "Você conhece a arquitetura do Regente e recebe trechos reais do código de produção.",
      "Priorize correções operacionais que permitam retomar a etapa sem alterar produção.",
      "Se o problema exigir mudança de código, não finja que aplicou: marque codeChangeRequired=true e proponha patch objetivo.",
      "Nunca contorne autenticação, RLS, autorização humana, limites de custo ou segurança.",
      "Não repita uma estratégia que já falhou sem uma razão concreta.",
      "O runtime classifica erros determinísticos localmente e só repete falhas transitórias em operações seguras. Não invente três tentativas nem recomende repetir configuração ausente.",
      "Seu diagnóstico é único e pode ser revisto pelo segundo guardião em contexto separado. Uma proposta de patch não significa código aplicado.",
      "Quando houver revisão independente do A4, trate-a como contraponto: compare hipóteses, resolva divergências e produza uma decisão consolidada.",
    ].join("\n"),
    outputType: RecoveryDecision,
  });

  const code = await sourceContext(input.node);
  const prompt = [
    `TAREFA: ${input.taskTitle}`,
    `OBJETIVO: ${input.objective}`,
    `ETAPA: ${input.step.step} / ${input.step.role}`,
    `NÓ: ${input.node}`,
    `AÇÃO: ${input.step.action}`,
    `ENTRADA: ${input.step.input}`,
    `SAÍDA ESPERADA: ${input.step.expectedOutput}`,
    `RECORRÊNCIA DO ERRO: ${input.recurrence}`,
    "",
    "ERRO NORMALIZADO:",
    normalizeError(input.error),
    "",
    "OUTPUTS ANTERIORES:",
    artifactsText(input.artifacts),
    "",
    input.previousRecovery ? `RECUPERAÇÃO ANTERIOR:\n${JSON.stringify(input.previousRecovery)}\n` : "",
    input.independentReview ? `REVISÃO INDEPENDENTE A4 (OPENAI, CONTEXTO SEPARADO):\n${input.independentReview}\n` : "",
    "CÓDIGO / ARQUITETURA RELEVANTE:",
    code,
  ].filter(Boolean).join("\n");

  const result = await run(agent, prompt, { maxTurns: 2, signal: AbortSignal.timeout(90_000) });
  if (!result.finalOutput) throw new Error("Recovery Engineer retornou saída vazia.");
  return result.finalOutput;
}

export async function reviewRecoveryWithOpenAI(input: {
  objective: string;
  taskTitle: string;
  step: PipelineStep;
  node: string;
  error: unknown;
  firstDecision: RecoveryDecisionOutput;
}) {
  const code = await sourceContext(input.node);
  const agent = new Agent({
    name: "A4 — Revisor independente de recovery",
    model:
      process.env.REGENT_REVIEW_MODEL ||
      process.env.REGENT_RECOVERY_MODEL ||
      process.env.REGENT_MODEL ||
      "gpt-5.6-sol",
    modelSettings: {
      reasoning: { effort: "high" },
      text: { verbosity: "medium" },
    },
    instructions: [
      "Você é o revisor independente A4 do mecanismo de recuperação do Regente.",
      guardianSpecialistInstructions("openai"),
      "Você executa com contexto separado do A5 e deve produzir um contraponto real.",
      "Analise o erro, a hipótese mais recente do Recovery Engineer e o código real.",
      "Destaque discordâncias, hipóteses alternativas e testes objetivos.",
      "Procure diagnóstico errado, repetição inútil, problemas de acesso, timeout, payload e bug de programação.",
      "Não proponha atalhos que removam autenticação, RLS, aprovação humana ou controles de custo.",
    ].join("\n"),
    outputType: IndependentRecoveryReview,
  });

  const prompt = [
    `TAREFA: ${input.taskTitle}`,
    `OBJETIVO: ${input.objective}`,
    `ETAPA: ${input.step.step} / ${input.step.role} / nó ${input.node}`,
    `ERRO: ${normalizeError(input.error)}`,
    `PRIMEIRA CORREÇÃO PROPOSTA: ${JSON.stringify(input.firstDecision)}`,
    "",
    "CÓDIGO RELEVANTE:",
    code,
  ].join("\n");

  const result = await run(agent, prompt, { maxTurns: 2, signal: AbortSignal.timeout(90_000) });
  if (!result.finalOutput) {
    throw new Error("O revisor independente A4 retornou saída vazia.");
  }
  return { available: true as const, review: result.finalOutput.review };
}

export function applyRecoveryDecision(step: PipelineStep, decision: RecoveryDecisionOutput) {
  return {
    ...step,
    action: decision.revisedAction?.trim() || step.action,
    input: decision.revisedInput?.trim() || step.input,
    expectedOutput: decision.revisedExpectedOutput?.trim() || step.expectedOutput,
  };
}
