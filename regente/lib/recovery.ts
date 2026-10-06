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
  claudeReview?: string | null;
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
      "Na tentativa 1, priorize correção operacional direta. Nas tentativas 2 e 3, use a revisão independente do Claude quando disponível e refine criticamente a estratégia.",
      "Se uma mudança de código parecer necessária, proponha o patch com precisão; nas tentativas seguintes procure também uma alternativa operacional segura antes de concluir que intervenção humana é indispensável.",
      "Quando houver revisão do Claude, trate-a como contraponto: compare hipóteses, resolva divergências e produza uma decisão consolidada.",
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
    input.claudeReview ? `REVISÃO INDEPENDENTE DO CLAUDE:\n${input.claudeReview}\n` : "",
    "CÓDIGO / ARQUITETURA RELEVANTE:",
    code,
  ].filter(Boolean).join("\n");

  const result = await run(agent, prompt);
  if (!result.finalOutput) throw new Error("Recovery Engineer retornou saída vazia.");
  return result.finalOutput;
}

export async function reviewRecoveryWithClaude(input: {
  objective: string;
  taskTitle: string;
  step: PipelineStep;
  node: string;
  error: unknown;
  firstDecision: RecoveryDecisionOutput;
}) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return {
      available: false as const,
      review: "Claude não está configurado neste ambiente (ANTHROPIC_API_KEY ausente).",
    };
  }

  const code = await sourceContext(input.node);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(70000),
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.REGENT_CLAUDE_MODEL || "claude-sonnet-4-5",
      max_tokens: 3500,
      messages: [{
        role: "user",
        content: [
          "Você é o revisor independente A4 do mecanismo de recuperação do Regente.",
          "Analise o erro, a hipótese mais recente do Recovery Engineer e o código real abaixo.",
          "Sua resposta será devolvida ao ChatGPT/A5 para uma nova rodada; destaque discordâncias, hipóteses alternativas e testes objetivos para criar uma análise cruzada real entre os dois modelos.",
          "Procure principalmente diagnóstico errado, repetição inútil, problemas de acesso, timeout, payload e bug de programação.",
          "Não proponha atalhos que removam autenticação, RLS ou aprovação humana.",
          "",
          `Tarefa: ${input.taskTitle}`,
          `Objetivo: ${input.objective}`,
          `Etapa: ${input.step.step} / ${input.step.role} / nó ${input.node}`,
          `Erro: ${normalizeError(input.error)}`,
          `Primeira correção proposta: ${JSON.stringify(input.firstDecision)}`,
          "",
          "Código relevante:",
          code,
        ].join("\n"),
      }],
    }),
  });

  const raw = await response.text();
  let body: { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } } | null = null;
  try { body = JSON.parse(raw); } catch {}
  if (!response.ok) {
    throw new Error(body?.error?.message || `Claude recovery HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  const review = body?.content?.filter((item) => item.type === "text").map((item) => item.text || "").join("\n").trim();
  if (!review) throw new Error("Claude recovery retornou resposta vazia.");
  return { available: true as const, review };
}

export function applyRecoveryDecision(step: PipelineStep, decision: RecoveryDecisionOutput) {
  return {
    ...step,
    action: decision.revisedAction?.trim() || step.action,
    input: decision.revisedInput?.trim() || step.input,
    expectedOutput: decision.revisedExpectedOutput?.trim() || step.expectedOutput,
  };
}
