import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireMaster();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.message },
      { status: auth.status },
    );
  }

  const { sessionId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: session, error: sessionError } = await supabase
    .from("regent_sessions")
    .select("id, title, budget_tier")
    .eq("id", sessionId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (sessionError || !session) {
    return NextResponse.json(
      { error: "session_not_found", message: "Conversa não encontrada." },
      { status: 404 },
    );
  }

  const { data: messages, error } = await supabase
    .from("regent_messages")
    .select("id, role, content, payload, created_at")
    .eq("session_id", sessionId)
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("regente_messages_load_failed", error);
    return NextResponse.json({ error: "messages_load_failed" }, { status: 500 });
  }

  const baseMessages = messages || [];
  const taskIds = [...new Set(
    baseMessages
      .map((message) => (message.payload as { taskId?: string } | null)?.taskId)
      .filter((value): value is string => Boolean(value))
  )];

  let enrichedMessages = baseMessages;
  if (taskIds.length) {
    const [{ data: tasks }, { data: steps }] = await Promise.all([
      supabase
        .from("regent_tasks")
        .select("id,status,current_step,progress_percent,next_action,autonomy_level,blocked_reason,last_error,updated_at")
        .eq("user_id", auth.userId)
        .in("id", taskIds),
      supabase
        .from("regent_task_steps")
        .select("task_id,step_number,status,depends_on,attempt_count,last_error,next_action,started_at,completed_at,updated_at")
        .eq("user_id", auth.userId)
        .in("task_id", taskIds)
        .order("step_number", { ascending: true }),
    ]);

    const taskMap = new Map((tasks || []).map((task) => [task.id, task]));
    enrichedMessages = baseMessages.map((message) => {
      const payload = message.payload as ({ taskId?: string } & Record<string, unknown>) | null;
      if (!payload?.taskId) return message;
      const task = taskMap.get(payload.taskId);
      if (!task) return message;
      return {
        ...message,
        payload: {
          ...payload,
          taskStatus: task.status,
          runtime: {
            currentStep: task.current_step,
            progressPercent: task.progress_percent,
            nextAction: task.next_action,
            autonomyLevel: task.autonomy_level,
            blockedReason: task.blocked_reason,
            lastError: task.last_error,
            updatedAt: task.updated_at,
            steps: (steps || []).filter((step) => step.task_id === payload.taskId),
          },
        },
      };
    });
  }

  return NextResponse.json({ session, messages: enrichedMessages });
}
