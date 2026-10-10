import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";
import { validatePhasePatch } from "../../../../../lib/phase-patch";

const decisions = new Set(["execute", "partial", "continue", "redo", "skip", "reject", "revise", "recover"]);
const explanations: Record<string, string> = {
  forbidden: "Somente o operador Master ativo pode autorizar a execução.",
  task_not_ready: "A pipeline ainda precisa ser preparada antes de executar.",
  task_closed: "A missão está encerrada. Use Refazer com nova orientação para criar uma nova versão.",
  recovery_not_required: "Não existe execução expirada a recuperar. Atualize e use a ação da fase atual.",
  phase_not_found: "A fase escolhida não existe nesta missão.",
  note_too_long: "A orientação deve ter no máximo 8.000 caracteres.",
  invalid_phase_patch: "A configuração solicitada não é válida. Escolha um executor e referências canônicas para inspecionar Canva.",
  revision_conflict: "O estado mudou desde a última leitura. Atualize o monitor antes de decidir.",
  execution_active: "Há uma invocação ativa. Aguarde o término ou a expiração do lock; não iniciar outra cópia.",
  phase_validation_required: "Revise os outputs e use Continuar para validar a fase antes de avançar.",
  phase_report_stale: "O relatório pertence a outra versão. Atualize o estado.",
  guidance_required: "Informe a orientação para refazer somente esta fase.",
  next_phase_only: "A 0.7 libera somente a próxima fase; as demais continuam pendentes.",
  dependencies_pending: "Há dependências pendentes. Revise a pipeline, sem simular resultados.",
  phase_not_optional: "Esta fase não pode ser pulada. Configure o adapter ou revise o plano.",
  skip_requires_pending_phase_and_reason: "Escolha uma fase opcional pendente e informe a razão para adiar.",
  task_not_found: "Tarefa não encontrada.",
  final_validation_required: "A última fase precisa ser validada antes de finalizar a missão.",
};

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "origin_mismatch" }, { status: 403 });
  const { taskId } = await params;
  const body = await request.json().catch(() => ({}));
  if (!decisions.has(body.decision)) return NextResponse.json({ error: "invalid_decision", message: "Decisão inválida." }, { status: 400 });
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    return NextResponse.json({ error: "revision_required", message: "Atualize a página para carregar a revisão atual antes de decidir." }, { status: 409 });
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const target = body.targetStep ?? body.step ?? (Array.isArray(body.approvedSteps) ? body.approvedSteps[0] : null);
  if (target != null && (!Number.isInteger(target) || target < 1)) return NextResponse.json({ error: "invalid_step" }, { status: 400 });
  let patch = null;
  if (body.phasePatch != null) {
    if (body.decision !== "redo" || !note || target == null) return NextResponse.json({ error: "invalid_phase_patch", message: "Alterar a configuração exige Refazer, a fase e uma orientação explícita." }, { status: 400 });
    try { patch = validatePhasePatch(body.phasePatch); } catch (error) {
      return NextResponse.json({ error: "invalid_phase_patch", message: (error as Error).message }, { status: 400 });
    }
  }
  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("regent_decide_phase", {
    p_task_id: taskId, p_expected_revision: body.expectedRevision, p_decision: body.decision, p_note: note, p_step: target, p_phase_patch: patch,
  });
  if (result.error) {
    const key = Object.keys(explanations).find((key) => result.error.message.startsWith(key));
    const status = key === "task_not_found" ? 404 : key ? 409 : 500;
    if (!key) console.error("regente_phase_decision_failed", { code: result.error.code });
    return NextResponse.json({ error: key || "decision_failed", message: key ? explanations[key] : "Não foi possível registrar a decisão com segurança." }, { status, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
