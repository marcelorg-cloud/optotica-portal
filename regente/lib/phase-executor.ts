import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildCanvaSpec, executeCanvaBridge, executeCanvaInspectBridge,
  executeIndependentOpenAIReviewer, executeOpenAIWorker, isOpenAINode, type PipelineStep,
} from "./adapters";
import { executeA5LocalPreflight } from "./a5-preflight";
import { artifactFingerprint } from "./artifact-fingerprint";
import { buildPhaseReport, dependencyArtifacts, failureDisposition, redactSecrets, type PhaseState } from "./phase-control";
import { analyzeRecovery, reviewRecoveryWithOpenAI } from "./recovery";
import { collectOrchestraHealth } from "./orchestra-health";

type Artifact = { step: number; node: string; output: unknown };
export type PhaseTask = {
  id: string; session_id: string; title: string; objective: string; pipeline: unknown; picker: unknown;
  human_decision: unknown; execution_id: string; execution_invocation_id: string; engine_version?: string;
};

function message(error: unknown) {
  return redactSecrets(error instanceof Error ? error.message : String(error || "Falha desconhecida."));
}
function stepRunReusable(step: PipelineStep, revision: number, run: { adapter: string; input: unknown; output: unknown }, artifacts: Artifact[]) {
  const input = run.input as { stepRevision?: number; step?: PipelineStep; priorArtifactFingerprint?: string } | null;
  if (revision > 1 && input?.stepRevision !== revision) return false;
  if (input?.step && artifactFingerprint(input.step) !== artifactFingerprint(step)) return false;
  const node = step.nodes[0];
  if (isOpenAINode(node) || node === "A4") return input?.priorArtifactFingerprint === artifactFingerprint(artifacts);
  if (node !== "F6") return node === "A5";
  // A legacy successful external effect must be reused, never recreated just because metadata was older.
  if (step.canvaMode === "create") return run.adapter === "canva_portal_bridge" && (Boolean(input?.step) || revision === 1);
  const references = run.input as { sourceRunIds?: string[]; designIds?: string[] } | null;
  return run.adapter === "canva_portal_inspect" &&
    artifactFingerprint([...(references?.sourceRunIds || [])].sort()) === artifactFingerprint([...(step.canvaSourceRunIds || [])].sort()) &&
    artifactFingerprint([...(references?.designIds || [])].sort()) === artifactFingerprint([...(step.canvaDesignIds || [])].sort());
}

/** One workflow invocation produces ONE phase, then stops at the persisted human gate. */
export async function executePhase(input: { supabase: SupabaseClient; userId: string; task: PhaseTask }) {
  const { supabase, userId, task } = input;
  const pipeline = (Array.isArray(task.pipeline) ? task.pipeline : []) as PipelineStep[];
  const stateResult = await supabase.from("regent_task_steps")
    .select("step_number,status,depends_on,revision,artifact,node_ids,validated_at,revision_guidance")
    .eq("task_id", task.id).eq("user_id", userId).order("step_number");
  if (stateResult.error) throw new Error("Não foi possível ler os checkpoints autenticados.");
  const states = (stateResult.data || []) as Array<PhaseState & { node_ids: string[]; revision_guidance?: string }>;
  const decision = task.human_decision as { approved_steps?: number[]; note?: string; requested_decision?: string } | null;
  const target = states.find((state) => state.step_number === decision?.approved_steps?.[0]);
  if (!target || decision?.approved_steps?.length !== 1 || ["succeeded", "skipped"].includes(target.status)) {
    throw new Error("A fase seguinte precisa de autorização humana específica. Nenhuma API externa foi executada.");
  }
  const originalStep = pipeline.find((step) => step.step === target.step_number);
  if (!originalStep) throw new Error("A etapa autorizada não corresponde à pipeline persistente.");
  const step = target.revision_guidance
    ? { ...originalStep, input: originalStep.input + "\n\nNOVA ORIENTAÇÃO HUMANA PARA ESTA VERSÃO:\n" + target.revision_guidance }
    : originalStep;
  const node = step.nodes[0] || "unknown";
  const artifacts: Artifact[] = dependencyArtifacts(states, step.step);
  let revision = Number(target.revision || 1);
  let attempts = 0;

  async function event(eventType: string, payload: unknown) {
    const result = await supabase.from("regent_task_events").insert({ task_id: task.id, user_id: userId, event_type: eventType, payload });
    if (result.error) throw new Error("Não foi possível persistir o evento de execução.");
  }
  async function begin() {
    const result = await supabase.rpc("regent_begin_phase", {
      p_task_id: task.id, p_execution_id: task.execution_id, p_invocation_id: task.execution_invocation_id, p_step: step.step,
    });
    if (result.error) throw result.error;
    revision = Number(result.data.revision);
    attempts++;
  }
  async function finish(status: string, output: unknown, error: unknown, recovered = false) {
    const report = ["succeeded", "skipped"].includes(status)
      ? buildPhaseReport({ step, revision, output, states }) : null;
    const result = await supabase.rpc("regent_finish_phase", {
      p_task_id: task.id, p_execution_id: task.execution_id, p_invocation_id: task.execution_invocation_id,
      p_step: step.step, p_revision: revision, p_status: status, p_artifact: output, p_report: report, p_error: error, p_recovered: recovered,
    });
    if (result.error) throw result.error;
    // The atomic checkpoint is the source of truth; a notification failure cannot undo it.
    try { await supabase.from("regent_messages").insert({
      session_id: task.session_id, user_id: userId, role: "assistant",
      content: report
        ? `Fase ${step.step} concluída e persistida. Revise os outputs para continuar ou refazer. A missão ainda não foi finalizada.`
        : `Fase ${step.step} pausada: ${(error as { action?: string } | null)?.action || "Confira o diagnóstico no monitor."}`,
      payload: { taskId: task.id, notification: true, phase: step.step, engineVersion: "0.7.0" },
    }); } catch { console.error("regente_phase_notification_unavailable", { taskId: task.id, step: step.step }); }
    return { ...result.data, phaseReport: report, artifacts: output == null ? [] : [{ step: step.step, node, output }], recoveryEscalated: !report };
  }

  async function run() {
    if (node === "A5") {
      const preflight = await executeA5LocalPreflight({ supabase, taskId: task.id, userId, step });
      const health = await collectOrchestraHealth({ supabase, userId, depth: "basic", taskId: task.id, requiredNodes: pipeline.flatMap((stage) => stage.nodes.slice(0, 1)) });
      return { ...preflight, orchestra: health };
    }
    if (isOpenAINode(node) || node === "A4") {
      if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY não configurada no runtime do Regente.");
      const adapter = node === "A4" ? "openai_agents_independent_review" : "openai_agents";
      const created = await supabase.from("regent_tool_runs").insert({
        task_id: task.id, user_id: userId, step_number: step.step, node_id: node, adapter, status: "running",
        input: { step, objective: task.objective, stepRevision: revision, executionId: task.execution_id, priorArtifactFingerprint: artifactFingerprint(artifacts) },
      }).select("id").single();
      if (created.error || !created.data) throw new Error("Não foi possível registrar o run OpenAI.");
      const runId = created.data.id;
      try {
        const output = node === "A4"
          ? await executeIndependentOpenAIReviewer({ step, objective: task.objective, priorArtifacts: artifacts })
          : await executeOpenAIWorker({ node, step, objective: task.objective, priorArtifacts: artifacts });
        if ((output as { blocked?: boolean }).blocked) throw new Error((output as { reason?: string }).reason || "Revisor indisponível.");
        const saved = await supabase.from("regent_tool_runs").update({ status: "succeeded", output, updated_at: new Date().toISOString() }).eq("id", runId).eq("task_id", task.id).eq("user_id", userId);
        if (saved.error) throw new Error("Output recebido, mas não persistido. Conferir o run original antes de retomar.");
        return output;
      } catch (error) {
        await supabase.from("regent_tool_runs").update({ status: "failed", output: { message: message(error) }, updated_at: new Date().toISOString() }).eq("id", runId).eq("task_id", task.id).eq("user_id", userId);
        throw error;
      }
    }
    if (node === "F6") {
      if (step.canvaMode === "inspect") return executeCanvaInspectBridge({ supabase, taskId: task.id, userId, step, revision, executionId: task.execution_id, executionInvocationId: task.execution_invocation_id });
      if (step.canvaMode !== "create") throw new Error("F6 precisa declarar canvaMode inspect/create e referências canônicas. Revise a etapa sem inventar IDs.");
      const active = await supabase.from("regent_tool_runs").select("id,status,input")
        .eq("task_id", task.id).eq("user_id", userId).eq("step_number", step.step)
        .in("status", ["pending", "running"]).eq("adapter", "canva_portal_bridge");
      if (active.error) throw new Error("Não foi possível conferir operações Canva em andamento.");
      if (active.data?.length) throw new Error("Existe uma criação Canva pendente no run original. Conferir o efeito externo antes de repetir.");
      if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY não configurada para preparar o design Canva.");
      const variants = Math.max(1, Math.min(3, Number((task.picker as { variantsRequested?: number } | null)?.variantsRequested || 1)));
      const spec = await buildCanvaSpec({ step, objective: task.objective, title: task.title, priorArtifacts: artifacts, variants });
      return executeCanvaBridge({ supabase, taskId: task.id, userId, step, spec, variants, revision, executionId: task.execution_id, executionInvocationId: task.execution_invocation_id });
    }
    if (node === "A6") {
      const reviews = await supabase.from("regent_task_events").select("id,payload,created_at")
        .eq("task_id", task.id).eq("user_id", userId).eq("event_type", "guardian_review_imported")
        .order("created_at", { ascending: false }).limit(50);
      if (reviews.error) throw new Error("Não foi possível ler a revisão externa autenticada.");
      const review = reviews.data?.find((entry) => {
        const value = entry.payload as { providerDeclared?: string; step?: number; revisionDeclared?: number; revisionMatches?: boolean; sourceCommitMatches?: boolean | null } | null;
        return value?.providerDeclared === "claude" && value.step === step.step && value.revisionDeclared === revision && value.revisionMatches === true && value.sourceCommitMatches === true;
      });
      if (!review) throw new Error("Adapter Claude automático não conectado. Baixe o pacote atualizado e importe uma revisão manual desta fase, revisão e commit do deployment; Claude.ai não comprova API.");
      const value = review.payload as { review?: string; sourceCommit?: string };
      return { result: value.review, source: "human_supplied", claimedProvider: "claude", providerVerified: false, eventId: review.id,
        notes: ["Revisão externa anexada pelo operador; origem declarada, não verificada automaticamente. Validação humana ainda necessária."] };
    }
    throw new Error(`Adapter do nó ${node} ainda não conectado. O afinamento mostra a configuração necessária.`);
  }

  try {
    await begin();
    const unresolved = (target.depends_on || []).filter((dependency) => !states.some((state) => state.step_number === dependency && ["succeeded", "skipped"].includes(state.status)));
    if (unresolved.length) throw new Error("Dependências pendentes: " + unresolved.join(", "));
    if (step.nodes.length > 1) {
      throw new Error("A fase exige múltiplos adapters ainda não conectados. Separe os nós ou forneça as fontes documentais; não simular execução dos nós secundários.");
    }
    const previous = await supabase.from("regent_tool_runs").select("id,adapter,input,output,node_id")
      .eq("task_id", task.id).eq("user_id", userId).eq("step_number", step.step).eq("status", "succeeded").order("created_at", { ascending: false }).limit(30);
    if (previous.error) throw new Error("Não foi possível conferir os runs bem-sucedidos.");
    const reusable = node === "A5" ? null : previous.data?.find((run) => stepRunReusable(step, revision, run, artifacts));
    if (reusable) return await finish("succeeded", reusable.output, null);
    // No auto-skips: only the persisted human skip decision can omit a phase.
    const health = await collectOrchestraHealth({ supabase, userId, depth: "basic", taskId: task.id, requiredNodes: node === "A6" ? ["A5"] : node === "F6" && step.canvaMode === "create" ? [node, "A1"] : [node] });
    await event("phase_preflight", { step: step.step, revision, report: health });
    if (health.summary.blockingCount > 0) {
      const blockers = health.checks.filter((check) => check.blocking);
      throw new Error(blockers.map((check) => check.action || check.detail).join(" ") || "Configuração de adapter incompleta; confira o afinamento.");
    }
    let error: unknown;
    const retryEvents: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 3; index++) {
      try {
        const output = await run();
        return await finish("succeeded", output, null, index > 0);
      } catch (failure) {
        error = failure;
        const disposition = failureDisposition(failure, node, step.canvaMode);
        retryEvents.push({ attempt: index + 1, ...disposition });
        await event("phase_attempt_failed", { step: step.step, revision, attempt: index + 1, ...disposition });
        if (!disposition.retry || index === 2) break;
        await event("phase_safe_retry", { step: step.step, revision, nextAttempt: index + 2, delayMs: 1000 * (index + 1), sameScope: true });
        await new Promise((resolve) => setTimeout(resolve, 1000 * (index + 1)));
        await begin();
      }
    }
    const disposition = failureDisposition(error, node, step.canvaMode);
    let specialist: unknown = null;
    // One dedicated diagnosis and one independent review. Never burn three analyses on a missing adapter.
    if (["unknown", "transient"].includes(disposition.kind) && process.env.OPENAI_API_KEY?.trim()) {
      try {
        const diagnosis = await analyzeRecovery({ objective: task.objective, taskTitle: task.title, step, node, error, artifacts, recurrence: attempts });
        const review = await reviewRecoveryWithOpenAI({ objective: task.objective, taskTitle: task.title, step, node, error, firstDecision: diagnosis });
        specialist = { provider: "openai", diagnosis, independentReview: review, codeApplied: false, externalClaudeInvoked: false };
        await event("guardian_diagnosis", { step: step.step, revision, specialist });
      } catch (diagnosticError) { specialist = { available: false, message: message(diagnosticError), codeApplied: false }; }
    }
    return await finish(disposition.retry ? "failed" : "blocked", null, { ...disposition, attempts, history: retryEvents, specialist, at: new Date().toISOString() });
  } catch (error) {
    const disposition = failureDisposition(error, node, step.canvaMode);
    if (!attempts) throw error;
    return await finish("blocked", null, { ...disposition, attempts, at: new Date().toISOString() });
  }
}
