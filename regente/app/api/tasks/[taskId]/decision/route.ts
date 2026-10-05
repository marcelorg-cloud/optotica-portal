import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";

type Decision = "execute" | "partial" | "reject" | "revise";

export async function POST(
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
  const body = await request.json().catch(() => ({}));
  const decision = body.decision as Decision;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const approvedSteps = Array.isArray(body.approvedSteps)
    ? body.approvedSteps.filter((step: unknown) => Number.isInteger(step) && Number(step) > 0).map(Number)
    : [];

  if (!["execute", "partial", "reject", "revise"].includes(decision)) {
    return NextResponse.json(
      { error: "invalid_decision", message: "Decisão inválida." },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: task, error } = await supabase
    .from("regent_tasks")
    .select("id, status, pipeline")
    .eq("id", taskId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (error || !task) {
    return NextResponse.json(
      { error: "task_not_found", message: "Tarefa não encontrada." },
      { status: 404 },
    );
  }

  if (!["awaiting_approval", "approved", "needs_revision"].includes(task.status)) {
    return NextResponse.json(
      { error: "invalid_state", message: `A tarefa está em estado ${task.status}.` },
      { status: 409 },
    );
  }

  const pipeline = Array.isArray(task.pipeline) ? task.pipeline : [];
  const missingAdapters = pipeline
    .filter((step: { executionState?: string }) => step.executionState === "requires_adapter")
    .flatMap((step: { nodes?: string[] }) => step.nodes || []);

  let nextStatus = "approved";
  let message = "Pipeline aprovado para execução supervisionada.";

  if (decision === "reject") {
    nextStatus = "rejected";
    message = "Pipeline rejeitado. Nenhuma ação externa foi executada.";
  } else if (decision === "revise") {
    nextStatus = "needs_revision";
    message = "Pipeline devolvido para revisão. Nenhuma ação externa foi executada.";
  } else if (decision === "partial") {
    if (!approvedSteps.length) {
      return NextResponse.json(
        { error: "steps_required", message: "Selecione ao menos uma etapa para execução parcial." },
        { status: 400 },
      );
    }
    nextStatus = "approved";
    message = `Execução parcial aprovada para as etapas ${approvedSteps.join(", ")}. Etapas sem adapter continuam bloqueadas.`;
  } else if (missingAdapters.length) {
    nextStatus = "approved";
    message =
      "Pipeline aprovado. A execução externa permanece bloqueada apenas nas etapas sem adapter conectado: " +
      [...new Set(missingAdapters)].join(", ") +
      ".";
  } else {
    nextStatus = "approved";
    message =
      "Pipeline aprovado. As etapas estão liberadas para o motor de execução supervisionada.";
  }

  const humanDecision = {
    decision,
    note: note || null,
    decided_at: new Date().toISOString(),
    missing_adapters: [...new Set(missingAdapters)],
    approved_steps: decision === "partial" ? approvedSteps : null,
  };

  const { error: updateError } = await supabase
    .from("regent_tasks")
    .update({
      status: nextStatus,
      human_decision: humanDecision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("user_id", auth.userId);

  if (updateError) {
    console.error("regente_task_decision_failed", updateError);
    return NextResponse.json(
      { error: "decision_failed", message: "Não foi possível registrar a decisão." },
      { status: 500 },
    );
  }

  await supabase.from("regent_task_events").insert({
    task_id: taskId,
    user_id: auth.userId,
    event_type:
      decision === "execute"
        ? "human_approved"
        : decision === "partial"
          ? "human_partial_approval"
          : decision === "reject"
          ? "human_rejected"
          : "human_requested_revision",
    payload: humanDecision,
  });

  return NextResponse.json({
    taskId,
    status: nextStatus,
    decision,
    missingAdapters: [...new Set(missingAdapters)],
    approvedSteps: decision === "partial" ? approvedSteps : null,
    executionAvailable: (decision === "execute" || decision === "partial") && missingAdapters.length === 0,
    message,
  });
}
