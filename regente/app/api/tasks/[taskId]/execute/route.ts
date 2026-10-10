import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireMaster, requireMasterBearer } from "../../../../../lib/require-master";
import { createBearerSupabaseClient, createServerSupabaseClient } from "../../../../../lib/supabase";
import { isValidWorkflowSecret, sealWorkflowSession } from "../../../../../lib/workflow-auth";
import { taskExecutionWorkflow } from "../../../../../workflows/task-execution";
import { executePhase, type PhaseTask } from "../../../../../lib/phase-executor";
import { redactSecrets } from "../../../../../lib/phase-control";
import { safeWorkflowOrigin } from "../../../../../lib/workflow-state";

export const runtime = "nodejs";
export const maxDuration = 800;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const workflowHeader = request.headers.get("x-regent-workflow");
  const internal = Boolean(workflowHeader);
  if (internal && !isValidWorkflowSecret(workflowHeader)) {
    return NextResponse.json({ error: "workflow_unauthorized", message: "Execução durável não autorizada." }, { status: 401, headers: NO_STORE });
  }
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const auth = internal ? await requireMasterBearer(bearer) : await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status, headers: NO_STORE });
  const userId = auth.userId;
  const supabase = internal ? createBearerSupabaseClient(bearer) : await createServerSupabaseClient();
  const read = await supabase.from("regent_tasks")
    .select("id,session_id,title,objective,status,pipeline,picker,human_decision,control_revision,execution_id,execution_invocation_id,execution_lease_until,engine_version")
    .eq("id", taskId).eq("user_id", userId).maybeSingle();
  if (read.error || !read.data) return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: read.error ? 500 : 404, headers: NO_STORE });
  const task = read.data;

  if (!internal) {
    if (task.status === "executing") return NextResponse.json({
      taskId, status: "executing", alreadyRunning: true,
      message: "A tarefa já está reservada. Se o monitor indicar expiração, use Recuperar execução, sem abrir outra cópia.",
    }, { status: 202, headers: NO_STORE });
    if (task.status === "succeeded") return NextResponse.json({ taskId, status: "succeeded", alreadyCompleted: true }, { headers: NO_STORE });
    const decision = task.human_decision as { approval_scope?: string; approved_steps?: number[] } | null;
    if (task.status !== "approved" || decision?.approval_scope !== "single_phase" || decision.approved_steps?.length !== 1) {
      return NextResponse.json({ error: "reapproval_required", message: "Autorize somente a próxima fase no monitor. Checkpoints e outputs serão preservados." }, { status: 409, headers: NO_STORE });
    }
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token || !session.refresh_token) return NextResponse.json({ error: "session_required", message: "Reentre no portal para renovar a sessão Master." }, { status: 401, headers: NO_STORE });
    const origin = safeWorkflowOrigin(new URL(request.url).origin, process.env.NODE_ENV === "production");
    if (!origin) return NextResponse.json({ error: "workflow_origin_invalid", message: "Origem do Regente não configurada para execução durável. Nenhuma sessão será enviada a outro endereço." }, { status: 409, headers: NO_STORE });
    let sealedSession: string;
    try { sealedSession = sealWorkflowSession({ accessToken: session.access_token, refreshToken: session.refresh_token }); }
    catch { return NextResponse.json({ error: "workflow_configuration_required", message: "Configure REGENT_WORKFLOW_SECRET no projeto Regente, mantendo o segredo existente quando válido. Nenhuma execução foi iniciada." }, { status: 503, headers: NO_STORE }); }
    const executionId = randomUUID();
    const locked = await supabase.from("regent_tasks").update({
      status: "executing", execution_id: executionId, execution_invocation_id: null, execution_lease_until: null,
      next_action: "Enfileirando somente a fase autorizada.", updated_at: new Date().toISOString(),
    }).eq("id", taskId).eq("user_id", userId).eq("status", "approved").eq("control_revision", task.control_revision).select("id").maybeSingle();
    if (locked.error || !locked.data) return NextResponse.json({ error: "execution_lock_conflict", message: "O estado mudou. Atualize o monitor; nenhuma nova cópia foi criada." }, { status: 409, headers: NO_STORE });
    try {
      const workflow = await start(taskExecutionWorkflow, [{
        taskId, userId, executionId,
        sealedSession, origin,
      }]);
      const queued = await supabase.from("regent_tasks").update({
        workflow_run_id: workflow.runId,
        next_action: "Fase em execução durável. Ao concluir, aguardará sua validação.",
        updated_at: new Date().toISOString(),
      }).eq("id", taskId).eq("user_id", userId).eq("execution_id", executionId).eq("status", "executing");
      if (queued.error) console.error("regente_workflow_metadata_failed", { taskId, code: queued.error.code });
      await supabase.from("regent_task_events").insert({
        task_id: taskId, user_id: userId, event_type: "workflow_enqueued",
        payload: { run_id: workflow.runId, execution_id: executionId, version: "0.7.0", steps: decision.approved_steps },
      });
      return NextResponse.json({ taskId, status: "executing", runId: workflow.runId, message: "Fase enfileirada. Fechar ou minimizar o painel não interrompe a execução." }, { status: 202, headers: NO_STORE });
    } catch (error) {
      const failure = redactSecrets(error instanceof Error ? error.message : String(error));
      await supabase.from("regent_tasks").update({
        status: "blocked", execution_id: null, execution_invocation_id: null, execution_lease_until: null,
        control_revision: task.control_revision + 1, workflow_run_id: null,
        next_action: "O envio à fila não foi confirmado. Confira os runs preservados antes de autorizar outra execução.",
        blocked_reason: "Falha ao confirmar o envio à fila; não repetir automaticamente.", last_error: { message: failure, kind: "queue_dispatch_unknown" },
        updated_at: new Date().toISOString(),
      }).eq("id", taskId).eq("user_id", userId).eq("execution_id", executionId).eq("status", "executing");
      await supabase.from("regent_task_events").insert({ task_id: taskId, user_id: userId, event_type: "workflow_enqueue_failed", payload: { message: failure } });
      return NextResponse.json({ error: "enqueue_failed", message: "Envio à fila não confirmado. A fase foi pausada; confira o diagnóstico antes de autorizar nova execução. Outputs preservados." }, { status: 503, headers: NO_STORE });
    }
  }

  const body = await request.json().catch(() => ({})) as { executionId?: string; invocationId?: string };
  if (!body.executionId || body.executionId !== task.execution_id) return NextResponse.json({ error: "stale_workflow", message: "A execução foi substituída; a invocação antiga não pode alterar checkpoints." }, { status: 409, headers: NO_STORE });
  if (["awaiting_validation", "succeeded", "blocked", "failed", "rejected", "needs_revision"].includes(task.status)) {
    return NextResponse.json({ taskId, status: task.status, checkpointPreserved: true, message: "Invocação já encerrada; nenhuma fase foi repetida." }, { headers: NO_STORE });
  }
  if (task.status !== "executing") return NextResponse.json({ error: "invalid_execution_state", message: "Fase não enfileirada." }, { status: 409, headers: NO_STORE });
  const invocationId = body.invocationId || randomUUID();
  if (task.execution_invocation_id || task.execution_lease_until) {
    return NextResponse.json({ error: "human_recovery_required", message: "Esta execução já recebeu uma invocação. Aguarde a reserva ou recupere pelo gate humano após expirar; nenhuma cópia será iniciada." }, { status: 409, headers: NO_STORE });
  }
  const claim = await supabase.from("regent_tasks").update({
    execution_invocation_id: invocationId, execution_lease_until: new Date(Date.now() + 810_000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", taskId).eq("user_id", userId).eq("execution_id", body.executionId).eq("status", "executing")
    .is("execution_invocation_id", null).is("execution_lease_until", null).select("id").maybeSingle();
  if (claim.error) return NextResponse.json({ error: "claim_failed", message: "Falha ao reservar a invocação; não foram executadas APIs externas." }, { status: 503, headers: NO_STORE });
  if (!claim.data) return NextResponse.json({ error: "workflow_lease_active", message: "Outra invocação ainda possui a fase." }, { status: 409, headers: NO_STORE });
  try {
    const result = await executePhase({ supabase, userId, task: { ...task, execution_invocation_id: invocationId } as PhaseTask });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const failure = redactSecrets(error instanceof Error ? error.message : String(error));
    // Fence the crash against a later human decision / workflow. Never erase the checkpoint.
    const saved = await supabase.from("regent_tasks").update({
      status: "blocked", execution_invocation_id: null, execution_lease_until: null,
      control_revision: task.control_revision + 1,
      next_action: "Confira o diagnóstico e autorize a retomada de somente esta fase.",
      blocked_reason: failure, last_error: { message: failure, at: new Date().toISOString() }, updated_at: new Date().toISOString(),
    }).eq("id", taskId).eq("user_id", userId).eq("execution_id", body.executionId).eq("execution_invocation_id", invocationId).eq("status", "executing").select("id");
    if (saved.data?.length) await supabase.from("regent_task_events").insert({
      task_id: taskId, user_id: userId, event_type: "phase_runtime_failed", payload: { message: failure },
    });
    return NextResponse.json({ taskId, status: "blocked", error: "phase_runtime_failed", message: failure }, { headers: NO_STORE });
  }
}
