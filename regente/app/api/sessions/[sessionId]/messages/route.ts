import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";
import { taskRuntime } from "../../../../../lib/task-runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status });
  const { sessionId } = await params;
  const supabase = await createServerSupabaseClient();
  const [session, messages, tasks] = await Promise.all([
    supabase.from("regent_sessions").select("id,title,budget_tier").eq("id", sessionId).eq("user_id", auth.userId).maybeSingle(),
    supabase.from("regent_messages").select("id,role,content,payload,created_at").eq("session_id", sessionId).eq("user_id", auth.userId).order("created_at"),
    supabase.from("regent_tasks").select("id,title,objective,pipeline,status,current_step,progress_percent,next_action,autonomy_level,blocked_reason,last_error,updated_at,phase_report,validated_steps,control_revision,engine_version,workflow_run_id,execution_lease_until").eq("session_id", sessionId).eq("user_id", auth.userId),
  ]);
  if (session.error || !session.data) return NextResponse.json({ error: "session_not_found", message: "Conversa não encontrada." }, { status: session.error ? 500 : 404 });
  if (messages.error || tasks.error) return NextResponse.json({ error: "messages_load_failed", message: "Não foi possível ler o estado atual. Atualize; o histórico permanece preservado." }, { status: 500 });
  const taskIds = (tasks.data || []).map((task) => task.id);
  const steps = taskIds.length ? await supabase.from("regent_task_steps")
    .select("task_id,step_number,role,node_ids,status,depends_on,attempt_count,last_error,next_action,started_at,completed_at,updated_at,revision,validated_at,recovered_at")
    .eq("user_id", auth.userId).in("task_id", taskIds) : { data: [], error: null };
  if (steps.error) return NextResponse.json({ error: "checkpoints_load_failed", message: "Não foi possível ler os checkpoints atuais. Nenhum resultado foi alterado." }, { status: 500 });
  const byTask = new Map((tasks.data || []).map((task) => [task.id, task]));
  const enriched = (messages.data || []).map((message) => {
    const payload = message.payload as ({ taskId?: string; pipeline?: unknown } & Record<string, unknown>) | null;
    if (!payload?.taskId) return message;
    const task = byTask.get(payload.taskId);
    if (!task) return message;
    const ownSteps = (steps.data || []).filter((step) => step.task_id === task.id);
    const current = taskRuntime(task, ownSteps);
    return { ...message, payload: {
      ...payload, taskTitle: task.title, objective: task.objective,
      ...(Array.isArray(payload.pipeline) ? { pipeline: task.pipeline } : {}), taskStatus: current.status,
      runtime: {
        currentStep: current.current_step, progressPercent: current.progress_percent, nextAction: current.next_action,
        autonomyLevel: task.autonomy_level, blockedReason: task.blocked_reason, lastError: task.last_error,
        updatedAt: task.updated_at, steps: ownSteps, isStale: current.is_stale, lastActivityAt: current.last_activity_at,
        attention: current.attention, recovery: current.recovery,
        phaseReport: task.phase_report, validatedSteps: task.validated_steps, controlRevision: task.control_revision,
        engineVersion: task.engine_version, workflowRunId: task.workflow_run_id, executionLeaseUntil: task.execution_lease_until,
      },
    } };
  });
  return NextResponse.json({ session: session.data, messages: enriched }, { headers: { "Cache-Control": "no-store" } });
}
