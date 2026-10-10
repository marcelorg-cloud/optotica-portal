import { createHash, randomBytes } from "node:crypto";
import { Agent, run } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { guardianSpecialistInstructions } from "./guardian-context";

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
      "Execute apenas o nó recebido; referências a outras ferramentas não comprovam execução dessas ferramentas.",
      "Não invente fontes, consultas jurídicas, vigência de normas, autorizações, documentos, gastos nem resultados externos. Sem fonte verificável, declare a limitação.",
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
  const result = await run(agent, agentInput, { maxTurns: 2, signal: AbortSignal.timeout(120_000) });
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
      guardianSpecialistInstructions("openai"),
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

  const result = await run(agent, prompt, { maxTurns: 2, signal: AbortSignal.timeout(120_000) });
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

  const result = await run(agent, prompt, { maxTurns: 2, signal: AbortSignal.timeout(120_000) });
  if (!result.finalOutput) throw new Error("Não foi possível montar a especificação do Canva.");
  return result.finalOutput;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

type CanvaBridgeContext = {
  supabase: SupabaseClient;
  taskId: string;
  userId: string;
  step: PipelineStep;
  revision?: number;
  executionId: string;
  executionInvocationId: string;
};

class CanvaBridgeError extends Error {
  constructor(message: string, public status = 503, public code = "canva_bridge_failed") { super(message); }
}

function safeCanvaBridgeUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com"));
  } catch { return false; }
}

/** HTTP 200 alone never proves that a Canva design exists or was saved. */
export function validCanvaBridgeOutput(value: unknown, expected: { mode: "create" | "inspect"; runId: string; step: number; revision: number; executionId: string; count: number; designIds?: string[] }) {
  const output = value as { mode?: unknown; complete?: unknown; runId?: unknown; step?: unknown; revision?: unknown; executionId?: unknown; designs?: unknown } | null;
  if (!output || output.mode !== expected.mode || output.complete !== true || output.runId !== expected.runId ||
    output.step !== expected.step || output.revision !== expected.revision || output.executionId !== expected.executionId ||
    !Array.isArray(output.designs) || output.designs.length !== expected.count) return false;
  const ids = new Set<string>();
  return output.designs.every((value) => {
    const design = value as { id?: unknown; editUrl?: unknown; viewUrl?: unknown; inspectionComplete?: unknown; pageCount?: unknown; pages?: unknown; previewUrls?: unknown } | null;
    if (!design || typeof design.id !== "string" || !/^[A-Za-z0-9_-]{6,80}$/.test(design.id) || ids.has(design.id) ||
      !safeCanvaBridgeUrl(design.editUrl) || !safeCanvaBridgeUrl(design.viewUrl)) return false;
    ids.add(design.id);
    if (expected.mode === "create") return true;
    return expected.designIds?.includes(design.id) === true && design.inspectionComplete === true &&
      Number.isInteger(design.pageCount) && Number(design.pageCount) > 0 && Array.isArray(design.pages) &&
      design.pages.length === design.pageCount && Array.isArray(design.previewUrls) && design.previewUrls.length > 0 &&
      design.previewUrls.every(safeCanvaBridgeUrl);
  });
}

async function callCanvaPortal(input: CanvaBridgeContext, mode: "create" | "inspect", details: Record<string, unknown>, count: number, designIds?: string[]) {
  const revision = input.revision ?? 1;
  if (!Number.isInteger(revision) || revision < 1 || !input.executionId || !input.executionInvocationId) {
    throw new CanvaBridgeError("A fase Canva precisa de revisão e invocação autorizadas. Atualize o monitor.", 409, "canva_execution_fence_required");
  }
  const portal = new URL(process.env.REGENT_PORTAL_ORIGIN || "https://app.optotica.com.br");
  if ((portal.protocol !== "https:" && !(portal.protocol === "http:" && portal.hostname === "localhost")) || portal.username || portal.password) {
    throw new CanvaBridgeError("REGENT_PORTAL_ORIGIN precisa de um endereço HTTPS válido, sem credenciais.", 503, "invalid_portal_origin");
  }
  const token = randomBytes(32).toString("base64url");
  const digest = tokenHash(token);
  const { data: toolRun, error } = await input.supabase.from("regent_tool_runs").insert({
    task_id: input.taskId, user_id: input.userId, step_number: input.step.step, node_id: "F6",
    adapter: mode === "create" ? "canva_portal_bridge" : "canva_portal_inspect", status: "pending",
    input: { mode, step: input.step, stepRevision: revision, executionId: input.executionId,
      executionInvocationId: input.executionInvocationId, ...details },
    token_hash: digest, token_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  }).select("id").single();
  if (error || !toolRun) throw new CanvaBridgeError("Não foi possível persistir a preparação da fase Canva; nenhuma chamada ao Portal foi feita.", 503, "canva_prepare_not_persisted");
  const expected = { mode, runId: toolRun.id, step: input.step.step, revision, executionId: input.executionId, count, designIds };

  async function canonicalRun() {
    const saved = await input.supabase.from("regent_tool_runs").select("status,output")
      .eq("id", toolRun!.id).eq("task_id", input.taskId).eq("user_id", input.userId).eq("node_id", "F6").maybeSingle();
    if (saved.error || !saved.data) throw new CanvaBridgeError("Não foi possível verificar o run Canva persistido. Não repita a criação até conferir o efeito externo.", 503, "canva_run_not_verified");
    return saved.data;
  }
  async function closeUnclaimed(message: string) {
    // CAS with the same token: if Portal has claimed it, preserve its canonical output untouched.
    const saved = await input.supabase.from("regent_tool_runs").update({
      status: "failed", token_hash: null, token_expires_at: null, updated_at: new Date().toISOString(),
      output: { mode, complete: false, designs: [], jobs: [], externalEffect: "none", runId: toolRun!.id,
        step: input.step.step, revision, executionId: input.executionId, message },
    }).eq("id", toolRun!.id).eq("task_id", input.taskId).eq("user_id", input.userId).eq("status", "pending")
      .eq("token_hash", digest).select("id").maybeSingle();
    if (saved.error) throw new CanvaBridgeError("Não foi possível invalidar a credencial não consumida. Confira o run Canva original antes de retomar.", 503, "canva_pending_not_persisted");
    return Boolean(saved.data);
  }

  let response: Response;
  try {
    response = await fetch(new URL("/api/internal/regente/canva", portal.origin), {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(110_000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: toolRun.id, token }),
    });
  } catch {
    const persisted = await canonicalRun();
    if (persisted.status === "succeeded" && validCanvaBridgeOutput(persisted.output, expected)) return persisted.output;
    const unclaimed = await closeUnclaimed("O transporte com o Portal foi interrompido antes de consumir esta credencial.");
    throw new CanvaBridgeError(unclaimed
      ? "O Portal não consumiu a chamada Canva; a credencial foi invalidada sem efeito externo. Autorize somente esta fase para retomar."
      : `O efeito externo Canva não foi confirmado. Confira o run ${toolRun.id}, os jobs e os outputs preservados; não repita a criação.`,
      503, unclaimed ? "canva_portal_not_claimed" : "canva_external_effect_unknown");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const persisted = await canonicalRun();
    if (persisted.status === "succeeded" && validCanvaBridgeOutput(persisted.output, expected)) return persisted.output;
    if (persisted.status === "pending") await closeUnclaimed("O Portal recusou a chamada Canva antes de consumir a credencial.");
    throw new CanvaBridgeError(typeof body?.message === "string" ? body.message.slice(0, 2200) : `O Portal não concluiu a fase Canva (HTTP ${response.status}). Confira o run original.`, response.status);
  }
  if (!validCanvaBridgeOutput(body, expected)) {
    await closeUnclaimed("O Portal retornou HTTP 200 sem confirmar o contrato de output Canva.");
    throw new CanvaBridgeError(`O Portal retornou um output Canva inválido. Confira o run ${toolRun.id}; um HTTP 200 não autoriza repetir a criação.`, 502, "invalid_canva_bridge_output");
  }
  const persisted = await canonicalRun();
  if (persisted.status !== "succeeded" || !validCanvaBridgeOutput(persisted.output, expected)) {
    throw new CanvaBridgeError(`O resultado Canva não foi confirmado no banco. Confira o run ${toolRun.id}; outputs parciais não serão sobrescritos.`, 503, "canva_result_not_persisted");
  }
  // The Portal is the sole writer of external results. Never overwrite it with a transport response.
  return persisted.output;
}

export async function executeCanvaBridge(input: CanvaBridgeContext & {
  spec: z.infer<typeof CanvaDesignSpec>;
  variants: number;
}) {
  if (!Number.isInteger(input.variants) || input.variants < 1 || input.variants > 3) throw new CanvaBridgeError("Quantidade de variantes Canva inválida.", 422);
  const previous = await input.supabase.from("regent_tool_runs").select("id,status,output")
    .eq("task_id", input.taskId).eq("user_id", input.userId).eq("step_number", input.step.step).eq("adapter", "canva_portal_bridge")
    .in("status", ["pending", "running", "failed"]);
  if (previous.error) throw new CanvaBridgeError("Não foi possível conferir criações Canva anteriores. Não iniciar outra importação.");
  const unsafe = previous.data?.find((run) => {
    const output = run.output as { externalEffect?: unknown; jobs?: unknown[]; designs?: unknown[] } | null;
    return run.status !== "failed" || output?.externalEffect !== "none" || Boolean(output.jobs?.length || output.designs?.length);
  });
  if (unsafe) throw new CanvaBridgeError(`Existe uma criação Canva não reconciliada no run ${unsafe.id}. Confira os designs e jobs preservados antes de autorizar outra importação.`, 409, "canva_external_effect_unknown");
  return callCanvaPortal(input, "create", { spec: input.spec, variants: input.variants }, input.variants);
}

export async function executeCanvaInspectBridge(input: CanvaBridgeContext) {
  const sourceRunIds = [...new Set(input.step.canvaSourceRunIds || [])];
  const designIds = [...new Set(input.step.canvaDesignIds || [])];
  if (!sourceRunIds.length || !designIds.length) {
    throw new Error("A inspeção Canva precisa de referências canônicas aprovadas.");
  }

  if (sourceRunIds.length > 20 || designIds.length > 10 || designIds.some((id) => !/^[A-Za-z0-9_-]{6,80}$/.test(id))) {
    throw new CanvaBridgeError("Referências canônicas Canva inválidas.", 422);
  }
  return callCanvaPortal(input, "inspect", { sourceRunIds, designIds }, designIds.length, designIds);
}

export function isOpenAINode(node: string) {
  return ["A1", "A2", "A3"].includes(node);
}
