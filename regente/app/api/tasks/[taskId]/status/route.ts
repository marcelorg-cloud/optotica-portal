import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";

export async function GET(
  _request: Request,
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
      supabase
        .from("regent_task_events")
        .select("id,event_type,payload,created_at")
        .eq("task_id", taskId)
        .eq("user_id", auth.userId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  if (taskError || !task) {
    return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: 404 });
  }
  if (stepsError || eventsError) {
    return NextResponse.json({ error: "task_state_failed", message: "Não foi possível carregar o estado da tarefa." }, { status: 500 });
  }

  return NextResponse.json({
    task,
    steps: steps || [],
    events: events || [],
  });
}
