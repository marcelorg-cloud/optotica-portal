import { deriveTaskObservability } from "./task-observability";

export function taskRuntime(task: Record<string, any>, steps: Array<Record<string, any>>, now = Date.now()) {
  const completed = steps.filter((step) => ["succeeded", "skipped"].includes(step.status)).length;
  const last = Math.max(new Date(task.updated_at || 0).getTime() || 0, ...steps.map((step) => new Date(step.updated_at || 0).getTime() || 0));
  const lease = task.execution_lease_until ? new Date(task.execution_lease_until).getTime() : null;
  const stale = task.status === "executing" && (lease != null ? lease <= now : last > 0 && now - last > 15 * 60_000);
  const active = steps.find((step) => ["running", "review"].includes(step.status));
  const next = steps.find((step) => !["succeeded", "skipped"].includes(step.status));
  const observation = deriveTaskObservability({ task: { ...task, status: task.status }, steps: steps as Array<{ step_number: number; status: string }>, isStale: stale });
  return {
    ...task,
    status: String(task.status),
    progress_percent: steps.length ? Math.round(completed * 100 / steps.length) : Number(task.progress_percent || 0),
    current_step: task.status === "succeeded" ? null : task.phase_report?.step ?? active?.step_number ?? next?.step_number ?? task.current_step ?? null,
    is_stale: stale,
    last_activity_at: last ? new Date(last).toISOString() : null,
    next_action: stale ? "A reserva de execução expirou. Use Recuperar execução para autorizar somente a fase pendente; outputs serão preservados." : task.next_action,
    attention: observation.attention, recovery: observation.recovery,
  };
}
