import { Agent, run } from "@openai/agents";
import { z } from "zod";
import type { PipelineStep } from "./adapters";

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
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
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
  return artifacts.slice(-6).map((item) =>
    `ETAPA ${item.step} / ${item.node}\n${typeof item.output === "string" ? item.output : JSON.stringify(item.output)}`
  ).join("\n\n").slice(0, 12000);
}

async function fetchSource(path: string) {
  const base = process.env.REGENT_REPO_RAW_BASE?.trim() ||
    "https://raw.githubusercontent.com/marcelorg-cloud/optotica-portal/main";
  const response = await fetch(`${base}/${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
    headers: { "User-Agent": "optotica-regente-recovery" },
  });
  if (!response.ok) return `[${path}] indisponível HTTP ${response.status}`;
  const text = await response.text();
  return `### ${path}\n${text.slice(0, 18000)}`;
}

async function sourceContext(node: string) {
  const common = [
    "regente/app/api/tasks/[taskId]/execute/route.ts",
    "regente/lib/adapters.ts",
  ];
  const paths = node === "F6"
    ? [...common, "app/api/internal/regente/canva/route.ts", "lib/canva/regent.ts"]
    : [...common, "regente/lib/regente.ts"];
  const values = await Promise.all(paths.map(fetchSource));
  return values.join("\n\n").slice(0, 52000);
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
    name: "A5 Recovery Engineer — Regente",
    model: process.env.REGENT_RECOVERY_MODEL || "gpt-5.6-sol",
    modelSettings: {
      reasoning: { effort: "high" },
      text: { verbosity: "medium" },
    },
    instructions: [
      "Você é o engenheiro de recuperação do Regente Optótica.",
      "Sua função é diagnosticar falhas de execução de pipeline e propor a menor correção segura.",
      "Você conhece a arquitetura do Regente e recebe trechos reais do código de produção.",
      "Priorize correções operacionais que permitam retomar a etapa sem alterar produção.",
      "Se o problema exigir mudança de código, não finja que aplicou: marque codeChangeRequired=true e proponha patch objetivo.",
      "Nunca contorne autenticação, RLS, autorização humana, limites de custo ou segurança.",
      "Não repita uma estratégia que já falhou sem uma razão concreta.",
      "O protocolo permite até 3 tentativas progressivas. Em cada recorrência, avance o diagnóstico com base no que falhou antes.",
      "Na tentativa 1, priorize correção operacional direta. Nas tentativas 2 e 3, use a revisão independente do A4 em uma execução OpenAI separada e refine criticamente a estratégia.",
      "Se uma mudança de código parecer necessária, proponha o patch com precisão; nas tentativas seguintes procure também uma alternativa operacional segura antes de concluir que intervenção humana é indispensável.",
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

  const result = await run(agent, prompt);
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

  const result = await run(agent, prompt);
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
