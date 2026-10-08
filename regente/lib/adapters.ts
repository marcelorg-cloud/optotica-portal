import { createHash, randomBytes } from "node:crypto";
import { Agent, run } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type PipelineStep = {
  step: number;
  role: "reference" | "planning" | "creative" | "critic" | "creation" | "picker" | "validation";
  nodes: string[];
  action: string;
  input: string;
  expectedOutput: string;
  executionState: "planned" | "ready" | "requires_adapter";
  requiresApproval: boolean;
  dependsOn?: number[];
  checkpoint?: boolean;
  canvaMode?: "inspect" | "create";
  canvaSourceRunIds?: string[];
  canvaDesignIds?: string[];
  onUnavailable?: "block" | "skip";
};

type PriorArtifact = {
  step: number;
  node: string;
  output: unknown;
};

const TextWorkerOutput = z.object({
  result: z.string(),
  notes: z.array(z.string()).max(8),
});

const CanvaDesignSpec = z.object({
  title: z.string().min(1).max(100),
  width: z.number().int().min(320).max(4000),
  height: z.number().int().min(320).max(4000),
  pages: z.array(z.object({
    eyebrow: z.string().max(90).default(""),
    headline: z.string().min(1).max(180),
    body: z.string().max(500).default(""),
    cta: z.string().max(80).default(""),
    visualDirection: z.string().max(260).default(""),
    emphasis: z.enum(["identity", "content", "urgency", "cta", "neutral"]).default("neutral"),
  })).min(1).max(6),
});

function contextFromArtifacts(artifacts: PriorArtifact[]) {
  if (!artifacts.length) return "Nenhum artefato anterior.";
  return artifacts
    .slice(-8)
    .map((item) => `ETAPA ${item.step} / ${item.node}:\n${typeof item.output === "string" ? item.output : JSON.stringify(item.output)}`)
    .join("\n\n");
}

function visualUrlsFromArtifacts(artifacts: PriorArtifact[]) {
  const values: string[] = [];
  const visit = (value: unknown) => {
    if (!value || values.length >= 12) return;
    if (typeof value === "string") {
      if (/^https:\/\//i.test(value) && /(?:preview|export|\.png(?:\?|$)|\.jpe?g(?:\?|$)|\.webp(?:\?|$))/i.test(value)) {
        values.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
  };
  artifacts.forEach((artifact) => visit(artifact.output));
  return [...new Set(values)].slice(0, 12);
}

export async function executeOpenAIWorker(input: {
  node: string;
  step: PipelineStep;
  objective: string;
  priorArtifacts: PriorArtifact[];
}) {
  const agent = new Agent({
    name: `Executor ${input.node}`,
    model: process.env.REGENT_WORKER_MODEL || process.env.REGENT_MODEL || "gpt-5.6-sol",
    instructions: [
      "Você é um nó executor da rede Optótica + ENSAVIM.",
      "Execute somente a etapa recebida. Não replaneje a tarefa inteira.",
      "Use o contexto anterior quando ele melhorar a consistência.",
      "Entregue conteúdo específico, aplicável e detalhado; evite prompts genéricos.",
      "Se estiver revisando, critique e devolva uma versão melhorada.",
    ].join("\n"),
    outputType: TextWorkerOutput,
  });

  const prompt = [
    `OBJETIVO GERAL: ${input.objective}`,
    `NÓ: ${input.node}`,
    `FUNÇÃO DA ETAPA: ${input.step.role}`,
    `AÇÃO: ${input.step.action}`,
    `ENTRADA: ${input.step.input}`,
    `SAÍDA ESPERADA: ${input.step.expectedOutput}`,
    "",
    "ARTEFATOS ANTERIORES:",
    contextFromArtifacts(input.priorArtifacts),
  ].join("\n");

  const visualUrls = visualUrlsFromArtifacts(input.priorArtifacts);
  const agentInput: string | AgentInputItem[] = visualUrls.length
    ? [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...visualUrls.map((image) => ({ type: "input_image" as const, image, detail: "high" })),
        ],
      }]
    : prompt;
  const result = await run(agent, agentInput);
  if (!result.finalOutput) throw new Error("O executor OpenAI retornou saída vazia.");
  return result.finalOutput;
}

export async function executeIndependentOpenAIReviewer(input: {
  step: PipelineStep;
  objective: string;
  priorArtifacts: PriorArtifact[];
}) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      blocked: true as const,
      reason: "OPENAI_API_KEY não configurada no ambiente do Regente.",
    };
  }

  const agent = new Agent({
    name: "Revisor independente A4",
    model:
      process.env.REGENT_REVIEW_MODEL ||
      process.env.REGENT_RECOVERY_MODEL ||
      process.env.REGENT_WORKER_MODEL ||
      process.env.REGENT_MODEL ||
      "gpt-5.6-sol",
    instructions: [
      "Você é o revisor independente A4 da rede Optótica + ENSAVIM.",
      "Trabalhe em uma execução separada dos demais nós e faça uma crítica genuína.",
      "Não apenas confirme o material anterior: identifique falhas, riscos, lacunas e alternativas.",
      "Preserve autenticação, RLS, aprovação humana e limites de custo.",
      "Devolva uma versão melhorada e notas objetivas sobre as mudanças.",
    ].join("\n"),
    outputType: TextWorkerOutput,
  });

  const prompt = [
    `OBJETIVO GERAL: ${input.objective}`,
    `FUNÇÃO DA ETAPA: ${input.step.role}`,
    `AÇÃO: ${input.step.action}`,
    `ENTRADA: ${input.step.input}`,
    `SAÍDA ESPERADA: ${input.step.expectedOutput}`,
    "",
    "ARTEFATOS ANTERIORES:",
    contextFromArtifacts(input.priorArtifacts),
    "",
    "Faça uma revisão crítica independente e devolva a melhor versão possível.",
  ].join("\n");

  const result = await run(agent, prompt);
  if (!result.finalOutput) {
    throw new Error("O revisor independente A4 retornou saída vazia.");
  }
  return {
    blocked: false as const,
    result: result.finalOutput.result,
    notes: result.finalOutput.notes,
  };
}

export async function buildCanvaSpec(input: {
  step: PipelineStep;
  objective: string;
  title: string;
  priorArtifacts: PriorArtifact[];
  variants: number;
}) {
  const agent = new Agent({
    name: "Arquiteto de design para Canva",
    model: process.env.REGENT_WORKER_MODEL || process.env.REGENT_MODEL || "gpt-5.6-sol",
    instructions: [
      "Converta o briefing e os artefatos anteriores em uma especificação visual concreta para Canva.",
      "Não invente dados factuais não fornecidos.",
      "Para criativos verticais use 1080x1920 salvo se a tarefa pedir outra dimensão.",
      "Para sequências de anúncio, normalmente use 4 páginas: identidade, conteúdo, urgência e CTA.",
      "Mantenha textos curtos e hierarquia clara. A saída será importada como design editável.",
    ].join("\n"),
    outputType: CanvaDesignSpec,
  });

  const prompt = [
    `TAREFA: ${input.title}`,
    `OBJETIVO: ${input.objective}`,
    `AÇÃO CANVA: ${input.step.action}`,
    `ENTRADA: ${input.step.input}`,
    `SAÍDA ESPERADA: ${input.step.expectedOutput}`,
    `VARIANTES SOLICITADAS: ${Math.max(1, Math.min(3, input.variants))}`,
    "",
    "ARTEFATOS ANTERIORES:",
    contextFromArtifacts(input.priorArtifacts),
  ].join("\n");

  const result = await run(agent, prompt);
  if (!result.finalOutput) throw new Error("Não foi possível montar a especificação do Canva.");
  return result.finalOutput;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function executeCanvaBridge(input: {
  supabase: SupabaseClient;
  taskId: string;
  userId: string;
  step: PipelineStep;
  spec: z.infer<typeof CanvaDesignSpec>;
  variants: number;
}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  const { data: toolRun, error } = await input.supabase
    .from("regent_tool_runs")
    .insert({
      task_id: input.taskId,
      user_id: input.userId,
      step_number: input.step.step,
      node_id: "F6",
      adapter: "canva_portal_bridge",
      status: "pending",
      input: { mode: "create", spec: input.spec, variants: input.variants },
      token_hash: tokenHash(token),
      token_expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !toolRun) {
    console.error("regent_canva_run_prepare_failed", {
      taskId: input.taskId,
      step: input.step.step,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    throw new Error(`Não foi possível preparar a execução do Canva${error?.code ? ` (${error.code})` : ""}.`);
  }

  const portalOrigin = (process.env.REGENT_PORTAL_ORIGIN || "https://app.optotica.com.br").replace(/\/$/, "");
  const response = await fetch(`${portalOrigin}/api/internal/regente/canva`, {
    method: "POST",
    signal: AbortSignal.timeout(110000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: toolRun.id, token }),
  });
  const body = await response.json().catch(() => null) as { message?: string; designs?: unknown[] } | null;

  if (!response.ok) {
    await input.supabase
      .from("regent_tool_runs")
      .update({ status: "failed", output: body || { message: `HTTP ${response.status}` }, updated_at: new Date().toISOString() })
      .eq("id", toolRun.id)
      .eq("user_id", input.userId);
    throw new Error(body?.message || "O Canva não concluiu a execução.");
  }

  await input.supabase
    .from("regent_tool_runs")
    .update({ status: "succeeded", output: body, token_hash: null, token_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", toolRun.id)
    .eq("user_id", input.userId);

  return body;
}

export async function executeCanvaInspectBridge(input: {
  supabase: SupabaseClient;
  taskId: string;
  userId: string;
  step: PipelineStep;
}) {
  const sourceRunIds = [...new Set(input.step.canvaSourceRunIds || [])];
  const designIds = [...new Set(input.step.canvaDesignIds || [])];
  if (!sourceRunIds.length || !designIds.length) {
    throw new Error("A inspeção Canva precisa de referências canônicas aprovadas.");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const { data: toolRun, error } = await input.supabase
    .from("regent_tool_runs")
    .insert({
      task_id: input.taskId,
      user_id: input.userId,
      step_number: input.step.step,
      node_id: "F6",
      adapter: "canva_portal_inspect",
      status: "pending",
      input: { mode: "inspect", sourceRunIds, designIds },
      token_hash: tokenHash(token),
      token_expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !toolRun) {
    console.error("regent_canva_inspect_prepare_failed", {
      taskId: input.taskId,
      step: input.step.step,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    throw new Error(`Não foi possível preparar a inspeção do Canva${error?.code ? ` (${error.code})` : ""}.`);
  }

  const portalOrigin = (process.env.REGENT_PORTAL_ORIGIN || "https://app.optotica.com.br").replace(/\/$/, "");
  const response = await fetch(`${portalOrigin}/api/internal/regente/canva`, {
    method: "POST",
    signal: AbortSignal.timeout(110000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: toolRun.id, token }),
  });
  const body = await response.json().catch(() => null) as { message?: string; designs?: unknown[] } | null;

  if (!response.ok) {
    await input.supabase
      .from("regent_tool_runs")
      .update({ status: "failed", output: body || { message: `HTTP ${response.status}` }, updated_at: new Date().toISOString() })
      .eq("id", toolRun.id)
      .eq("user_id", input.userId);
    throw new Error(body?.message || "O Canva não concluiu a inspeção.");
  }

  await input.supabase
    .from("regent_tool_runs")
    .update({ status: "succeeded", output: body, token_hash: null, token_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", toolRun.id)
    .eq("user_id", input.userId);
  return body;
}

export function isOpenAINode(node: string) {
  return ["A1", "A2", "A3"].includes(node);
}
