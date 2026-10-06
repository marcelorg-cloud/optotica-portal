import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStep } from "./adapters";

type StepStatus =
  | "planned"
  | "prepared"
  | "awaiting_approval"
  | "running"
  | "review"
  | "succeeded"
  | "blocked"
  | "failed"
  | "skipped";

function now() {
  return new Date().toISOString();
}

export async function initializeTaskSteps(input: {
  supabase: SupabaseClient;
  taskId: string;
  userId: string;
  pipeline: PipelineStep[];
  approvalRequired: boolean;
}) {
  if (!input.pipeline.length) return;

  const rows = input.pipeline.map((step, index) => ({
    task_id: input.taskId,
    user_id: input.userId,
    step_number: step.step,
    role: step.role,
    node_ids: step.nodes || [],
    action: step.action,
    expected_output: step.expectedOutput,
    status: input.approvalRequired && step.requiresApproval
      ? "awaiting_approval"
      : step.executionState === "planned"
        ? "planned"
        : "prepared",
    depends_on: step.dependsOn?.length ? step.dependsOn : index > 0 ? [input.pipeline[index - 1].step] : [],
    next_action: index === 0 ? step.action : null,
  }));

  const { error } = await input.supabase
    .from("regent_task_steps")
    .upsert(rows, { onConflict: "task_id,step_number" });
  if (error) throw error;
}

export async function markTaskStep(input: {
  supabase: SupabaseClient;
  taskId: string;
  userId: string;
  stepNumber: number;
  status: StepStatus;
  artifact?: unknown;
  error?: unknown;
  nextAction?: string | null;
  incrementAttempt?: boolean;
}) {
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: now(),
  };

  if (input.status === "running") patch.started_at = now();
  if (["succeeded", "blocked", "failed", "skipped"].includes(input.status)) patch.completed_at = now();
  if (input.artifact !== undefined) patch.artifact = input.artifact;
  if (input.error !== undefined) {
    patch.last_error = {
      message: input.error instanceof Error ? input.error.message : String(input.error),
      at: now(),
    };
  }
  if (input.nextAction !== undefined) patch.next_action = input.nextAction;

  if (input.incrementAttempt) {
    const current = await input.supabase
      .from("regent_task_steps")
      .select("attempt_count")
      .eq("task_id", input.taskId)
      .eq("user_id", input.userId)
      .eq("step_number", input.stepNumber)
      .maybeSingle();
    patch.attempt_count = Number(current.data?.attempt_count || 0) + 1;
  }

  const { error } = await input.supabase
    .from("regent_task_steps")
    .update(patch)
    .eq("task_id", input.taskId)
    .eq("user_id", input.userId)
    .eq("step_number", input.stepNumber);
  if (error) throw error;
}

export async function syncTaskProgress(input: {
  supabase: SupabaseClient;
  taskId: string;
  userId: string;
  fallbackNextAction?: string | null;
}) {
  const { data: steps, error } = await input.supabase
    .from("regent_task_steps")
    .select("step_number,status,action,next_action")
    .eq("task_id", input.taskId)
    .eq("user_id", input.userId)
    .order("step_number", { ascending: true });
  if (error) throw error;

  const list = steps || [];
  const done = list.filter((step) => ["succeeded", "skipped"].includes(step.status)).length;
  const progress = list.length ? Math.round((done / list.length) * 100) : 0;
  const active = list.find((step) => ["running", "review"].includes(step.status));
  const pending = list.find((step) => ["prepared", "planned", "awaiting_approval"].includes(step.status));
  const blocked = list.find((step) => ["blocked", "failed"].includes(step.status));
  const current = active || blocked || pending || null;

  const nextAction =
    blocked?.next_action ||
    active?.next_action ||
    pending?.next_action ||
    input.fallbackNextAction ||
    (progress === 100 ? "Tarefa concluída." : null);

  const { error: updateError } = await input.supabase
    .from("regent_tasks")
    .update({
      current_step: current?.step_number || null,
      progress_percent: progress,
      next_action: nextAction,
      blocked_reason: blocked ? blocked.next_action || "Etapa bloqueada; revisar detalhes." : null,
      updated_at: now(),
    })
    .eq("id", input.taskId)
    .eq("user_id", input.userId);
  if (updateError) throw updateError;

  return { progress, currentStep: current?.step_number || null, nextAction };
}
