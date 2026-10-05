import { createHash, randomBytes } from "node:crypto";
import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { createServerSupabaseClient } from "./supabase";

export type PipelineStep = {
  step: number;
  role: "reference" | "planning" | "creative" | "critic" | "creation" | "picker" | "validation";
  nodes: string[];
  action: string;
  input: string;
  expectedOutput: string;
  executionState: "planned" | "ready" | "requires_adapter";
  requiresApproval: boolean;
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

  const result = await run(agent, prompt);
  return result.finalOutput;
}

export async function executeClaudeWorker(input: {
  step: PipelineStep;
  objective: string;
  priorArtifacts: PriorArtifact[];
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return {
      blocked: true as const,
      reason: "ANTHROPIC_API_KEY não configurada no ambiente do Regente.",
    };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.REGENT_CLAUDE_MODEL || "claude-sonnet-4-5",
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: [
          `Objetivo: ${input.objective}`,
          `Função: ${input.step.role}`,
          `Ação: ${input.step.action}`,
          `Entrada: ${input.step.input}`,
          `Saída esperada: ${input.step.expectedOutput}`,
          "Contexto anterior:",
          contextFromArtifacts(input.priorArtifacts),
          "Faça uma revisão crítica independente e devolva a melhor versão possível, sem conversa desnecessária.",
        ].join("\n\n"),
      }],
    }),
  });

  const body = await response.json().catch(() => null) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(body?.error?.message || `Claude respondeu HTTP ${response.status}`);
  }

  const text = body?.content?.filter((item) => item.type === "text").map((item) => item.text || "").join("\n").trim();
  if (!text) throw new Error("Claude retornou resposta vazia.");
  return { blocked: false as const, result: text };
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
  return result.finalOutput;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function executeCanvaBridge(input: {
  taskId: string;
  userId: string;
  step: PipelineStep;
  spec: z.infer<typeof CanvaDesignSpec>;
  variants: number;
}) {
  const supabase = await createServerSupabaseClient();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  const { data: toolRun, error } = await supabase
    .from("regent_tool_runs")
    .insert({
      task_id: input.taskId,
      user_id: input.userId,
      step_number: input.step.step,
      node_id: "F6",
      adapter: "canva_portal_bridge",
      status: "pending",
      input: { spec: input.spec, variants: input.variants },
      token_hash: tokenHash(token),
      token_expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !toolRun) throw new Error("Não foi possível preparar a execução do Canva.");

  const portalOrigin = (process.env.REGENT_PORTAL_ORIGIN || "https://optotica-portal.vercel.app").replace(/\/$/, "");
  const response = await fetch(`${portalOrigin}/api/internal/regente/canva`, {
    method: "POST",
    signal: AbortSignal.timeout(110000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: toolRun.id, token }),
  });
  const body = await response.json().catch(() => null) as { message?: string; designs?: unknown[] } | null;

  if (!response.ok) {
    await supabase
      .from("regent_tool_runs")
      .update({ status: "failed", output: body || { message: `HTTP ${response.status}` }, updated_at: new Date().toISOString() })
      .eq("id", toolRun.id)
      .eq("user_id", input.userId);
    throw new Error(body?.message || "O Canva não concluiu a execução.");
  }

  await supabase
    .from("regent_tool_runs")
    .update({ status: "succeeded", output: body, token_hash: null, token_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", toolRun.id)
    .eq("user_id", input.userId);

  return body;
}

export function isOpenAINode(node: string) {
  return ["A1", "A2", "A3"].includes(node);
}
