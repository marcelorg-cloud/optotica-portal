import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";
import { deriveTaskObservability } from "../../../../../lib/task-observability";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireMaster();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.message },
      { status: auth.status },
    );
  }

  const { taskId } = await params;
  const supabase = await createServerSupabaseClient();
  const compact = new URL(request.url).searchParams.get("compact") === "1";
  const STALE_AFTER_MS = 15 * 60 * 1000;

  const eventsPromise = compact
    ? Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null })
    : supabase
        .from("regent_task_events")
        .select("id,event_type,payload,created_at")
        .eq("task_id", taskId)
        .eq("user_id", auth.userId)
        .order("created_at", { ascending: false })
        .limit(30);

  const [{ data: task, error: taskError }, { data: steps, error: stepsError }, { data: events, error: eventsError }] =
    await Promise.all([
      supabase
        .from("regent_tasks")
        .select("id,title,objective,status,current_step,progress_percent,next_action,autonomy_level,blocked_reason,last_error,updated_at")
        .eq("id", taskId)
        .eq("user_id", auth.userId)
        .maybeSingle(),
      supabase
        .from("regent_task_steps")
        .select("step_number,role,node_ids,action,expected_output,status,depends_on,checkpoint,attempt_count,last_error,next_action,started_at,completed_at,updated_at")
        .eq("task_id", taskId)
        .eq("user_id", auth.userId)
        .order("step_number", { ascending: true }),
      eventsPromise,
    ]);

  if (taskError || !task) {
    return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: 404 });
  }
  if (stepsError || eventsError) {
    return NextResponse.json({ error: "task_state_failed", message: "Não foi possível carregar o estado da tarefa." }, { status: 500 });
  }

  const allSteps = steps || [];
  const completed = allSteps.filter((step) =>
    step.status === "succeeded" || step.status === "skipped"
  ).length;
  const progress = task.status === "succeeded"
    ? 100
    : allSteps.length
      ? Math.round(completed * 100 / allSteps.length)
      : Math.max(0, Math.min(100, Number(task.progress_percent || 0)));

  const mostRecentActivity = Math.max(
    new Date(task.updated_at || 0).getTime() || 0,
    ...allSteps.map((step) => new Date(step.updated_at || 0).getTime() || 0),
  );
  const isStale = task.status === "executing" &&
    mostRecentActivity > 0 &&
    Date.now() - mostRecentActivity > STALE_AFTER_MS;

  const activeStep = allSteps.find((step) =>
    ["running", "review"].includes(step.status)
  );
  const pendingStep = allSteps.find((step) =>
    ["planned", "prepared", "awaiting_approval"].includes(step.status)
  );
  const observability = deriveTaskObservability({
    task,
    steps: allSteps,
    isStale,
  });

  return NextResponse.json({
    task: {
      ...task,
      progress_percent: progress,
      current_step: task.status === "succeeded"
        ? null
        : activeStep?.step_number ?? task.current_step ?? pendingStep?.step_number ?? null,
      is_stale: isStale,
      last_activity_at: mostRecentActivity ? new Date(mostRecentActivity).toISOString() : null,
      next_action: isStale
        ? "Sem atualização de execução há mais de 15 minutos. A tarefa pode estar interrompida; confira o último checkpoint antes de retomar."
        : task.next_action,
      attention: observability.attention,
      recovery: observability.recovery,
    },
    steps: allSteps,
    events: events || [],
  });
}
