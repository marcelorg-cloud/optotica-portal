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
    const progressByTask = new Map<string, {
      percent: number;
      isStale: boolean;
      lastActivityAt: string | null;
      currentStep: number | null;
    }>();
    for (const task of tasks || []) {
      const ownSteps = (steps || []).filter((step) => step.task_id === task.id);
      const completed = ownSteps.filter((step) =>
        ["succeeded", "skipped"].includes(step.status)
      ).length;
      const percent = task.status === "succeeded"
        ? 100
        : ownSteps.length
          ? Math.round(completed * 100 / ownSteps.length)
          : Math.max(0, Math.min(100, Number(task.progress_percent || 0)));
      const last = Math.max(
        new Date(task.updated_at || 0).getTime() || 0,
        ...ownSteps.map((step) => new Date(step.updated_at || 0).getTime() || 0)
      );
      const active = ownSteps.find((step) => ["running", "review"].includes(step.status));
      progressByTask.set(task.id, {
        percent,
        isStale: task.status === "executing" && last > 0 && Date.now() - last > 15 * 60 * 1000,
        lastActivityAt: last ? new Date(last).toISOString() : null,
        currentStep: task.status === "succeeded" ? null : active?.step_number ?? task.current_step,
      });
    }
    enrichedMessages = baseMessages.map((message) => {
      const payload = message.payload as ({ taskId?: string } & Record<string, unknown>) | null;
      if (!payload?.taskId) return message;
      const task = taskMap.get(payload.taskId);
      if (!task) return message;
      const progress = progressByTask.get(task.id);
      return {
        ...message,
        payload: {
          ...payload,
          taskStatus: task.status,
          runtime: {
            currentStep: progress?.currentStep ?? task.current_step,
            progressPercent: progress?.percent ?? task.progress_percent,
            isStale: progress?.isStale ?? false,
            lastActivityAt: progress?.lastActivityAt ?? null,
            nextAction: progress?.isStale
              ? "Sem atualização há mais de 15 minutos. Verifique a execução antes de retomá-la."
              : task.next_action,
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
