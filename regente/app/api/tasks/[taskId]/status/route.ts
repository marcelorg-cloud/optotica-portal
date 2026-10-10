import { NextResponse } from "next/server";
import { getWorld } from "workflow/runtime";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";
import { taskRuntime } from "../../../../../lib/task-runtime";
import { safeWorkflowRunId, workflowObservation, withWorkflowObservation, type WorkflowObservation } from "../../../../../lib/workflow-state";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

async function readWorkflowObservation(runId: string | null): Promise<WorkflowObservation> {
  if (!runId) return workflowObservation({ reason: "not_linked" });
  if (!safeWorkflowRunId(runId)) return workflowObservation({ runId, reason: "invalid_run" });
  // Never initialize a Local World on a production Vercel filesystem because
  // system environment variables were omitted. No auth/config fallback here.
  if (process.env.NODE_ENV === "production" && !process.env.VERCEL_DEPLOYMENT_ID && !process.env.WORKFLOW_TARGET_WORLD) {
    return workflowObservation({ runId, reason: "unavailable" });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = (async () => {
    try {
      const world = await getWorld();
      const run = await world.runs.get(runId, { resolveData: "none" });
      return workflowObservation({ runId, run: run as unknown as Record<string, unknown>, currentDeploymentId: process.env.VERCEL_DEPLOYMENT_ID });
    } catch {
      // Do not expose raw backend errors or inspect protected serialized IO.
      return workflowObservation({ runId, reason: "unavailable" });
    }
  })();
  try {
    return await Promise.race([
      read,
      new Promise<WorkflowObservation>((resolve) => {
        timer = setTimeout(() => resolve(workflowObservation({ runId, reason: "timeout" })), 2_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status, headers: NO_STORE });
  const { taskId } = await params;
  const supabase = await createServerSupabaseClient();
  const compact = new URL(request.url).searchParams.get("compact") === "1";
  const [task, steps, events] = await Promise.all([
    supabase.from("regent_tasks").select("id,title,objective,status,current_step,progress_percent,next_action,autonomy_level,blocked_reason,last_error,updated_at,phase_report,validated_steps,control_revision,engine_version,workflow_run_id,execution_lease_until").eq("id", taskId).eq("user_id", auth.userId).maybeSingle(),
    supabase.from("regent_task_steps").select("step_number,role,node_ids,action,expected_output,status,depends_on,checkpoint,attempt_count,last_error,next_action,started_at,completed_at,updated_at,revision,validated_at,recovered_at").eq("task_id", taskId).eq("user_id", auth.userId).order("step_number"),
    compact ? Promise.resolve({ data: [], error: null }) : supabase.from("regent_task_events").select("id,event_type,payload,created_at").eq("task_id", taskId).eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(40),
  ]);
  if (task.error || !task.data) return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: task.error ? 500 : 404, headers: NO_STORE });
  if (steps.error || events.error) return NextResponse.json({ error: "task_state_failed", message: "Não foi possível ler o estado persistente. Nenhum checkpoint foi alterado." }, { status: 500, headers: NO_STORE });
  // Only the run linked to this authenticated user's persisted task is queried.
  // This GET does not enqueue, recover, cancel, write events or alter checkpoints.
  const workflow = await readWorkflowObservation(task.data.workflow_run_id);
  const observed = withWorkflowObservation(taskRuntime(task.data, steps.data || []), workflow);
  return NextResponse.json({ task: observed, steps: steps.data || [], events: events.data || [] }, { headers: NO_STORE });
}
