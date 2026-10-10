import { NextResponse } from "next/server";
import { requireMaster } from "../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../lib/supabase";
import { buildGuardianPacket, guardianSourceCommit, loadGuardianSourceSnapshot, sanitizeGuardianEvidence } from "../../../../lib/guardian-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validProvider = (provider: unknown): provider is "openai" | "claude" => provider === "openai" || provider === "claude";

// Export a versioned evidence packet, with no automatic provider call, approval
// or DB mutation. Source retrieval is pinned to the deployed commit or omitted.
export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "access_denied", message: auth.message }, { status: auth.status, headers: NO_STORE });
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") || "claude";
  const taskId = url.searchParams.get("taskId");
  const download = url.searchParams.get("download") === "1";
  if (!validProvider(provider) || (taskId && !UUID.test(taskId))) return NextResponse.json({ error: "invalid_guardian_request" }, { status: 400, headers: NO_STORE });
  const supabase = await createServerSupabaseClient();
  let task = null;
  let steps: unknown[] = [];
  let runs: unknown[] = [];
  let events: unknown[] = [];
  if (taskId) {
    const taskResult = await supabase.from("regent_tasks")
      .select("id,title,objective,status,depth,risk,budget_tier,pipeline,human_decision,current_step,progress_percent,next_action,blocked_reason,engine_version,control_revision,phase_report,validated_steps,created_at,updated_at")
      .eq("id", taskId).eq("user_id", auth.userId).maybeSingle();
    if (taskResult.error) return NextResponse.json({ error: "guardian_task_read_failed", message: "Não foi possível ler a missão autorizada; nenhum pacote foi emitido." }, { status: 503, headers: NO_STORE });
    if (!taskResult.data) return NextResponse.json({ error: "task_not_found" }, { status: 404, headers: NO_STORE });
    task = taskResult.data;
    const [stepResult, runResult, eventResult] = await Promise.all([
      supabase.from("regent_task_steps")
        .select("step_number,role,node_ids,action,expected_output,status,depends_on,revision,validated_at,recovered_at,artifact,attempt_count,last_error,next_action,started_at,completed_at,updated_at")
        .eq("task_id", taskId).eq("user_id", auth.userId).order("step_number", { ascending: true }).limit(50),
      supabase.from("regent_tool_runs").select("id,step_number,node_id,adapter,status,output,created_at,updated_at")
        .eq("task_id", taskId).eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(80),
      supabase.from("regent_task_events").select("id,event_type,payload,created_at")
        .eq("task_id", taskId).eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(80),
    ]);
    if (stepResult.error || runResult.error || eventResult.error) return NextResponse.json({ error: "guardian_evidence_read_failed",
      message: "A leitura de checkpoints/outputs/histórico falhou. O pacote não foi emitido como se estivesse completo." }, { status: 503, headers: NO_STORE });
    steps = stepResult.data || []; runs = runResult.data || []; events = eventResult.data || [];
  }
  const reportResult = await supabase.from("regent_orchestra_checks").select("report,created_at")
    .eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (reportResult.error) return NextResponse.json({ error: "guardian_orchestra_read_failed", message: "O histórico de afinamento está indisponível; confira a migração 0.7." }, { status: 503, headers: NO_STORE });
  const sources = url.searchParams.get("source") === "0" ? undefined : await loadGuardianSourceSnapshot();
  const packet = buildGuardianPacket({ provider, task, steps, runs, events, sources,
    orchestraReport: reportResult.data ? { ...reportResult.data.report, persistedAt: reportResult.data.created_at } : null });
  if (download) return new Response(JSON.stringify(packet, null, 2), { headers: { ...NO_STORE,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="regente-0.7-${provider}-${taskId || "architecture"}.json"` } });
  return NextResponse.json({ packet }, { headers: NO_STORE });
}

// A manual review is provenance-labelled evidence, not a task authorization or
// proof that an API/model/account executed. Only the decision endpoint advances.
export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "access_denied", message: auth.message }, { status: auth.status, headers: NO_STORE });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers: NO_STORE });
  if (!request.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "json_required" }, { status: 415, headers: NO_STORE });
  if (Number(request.headers.get("content-length") || 0) > 120_000) return NextResponse.json({ error: "review_too_large" }, { status: 413, headers: NO_STORE });
  const text = await request.text();
  if (text.length > 100_000) return NextResponse.json({ error: "review_too_large" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(text); } catch { /* Invalid JSON is rejected below. */ }
  if (!body || !validProvider(body.provider) || typeof body.taskId !== "string" || !UUID.test(body.taskId) ||
    typeof body.review !== "string" || body.review.trim().length < 20 || body.review.length > 48_000 ||
    body.acknowledgeManualSource !== true ||
    (body.packetId !== undefined && (typeof body.packetId !== "string" || !/^gp7-[a-f0-9]{24}$/.test(body.packetId))) ||
    (body.sourceCommit !== undefined && (typeof body.sourceCommit !== "string" || !/^[a-f0-9]{40}$/i.test(body.sourceCommit))) ||
    (body.step !== undefined && (!Number.isInteger(body.step) || Number(body.step) < 1 || Number(body.step) > 50)) ||
    (body.revision !== undefined && (!Number.isInteger(body.revision) || Number(body.revision) < 1))) {
    return NextResponse.json({ error: "invalid_guardian_review", message: "Informe missão, provedor declarado e parecer. Confirme que é uma importação humana, não uma execução automática verificada." }, { status: 400, headers: NO_STORE });
  }
  const supabase = await createServerSupabaseClient();
  const taskResult = await supabase.from("regent_tasks").select("id,engine_version,control_revision")
    .eq("id", body.taskId).eq("user_id", auth.userId).maybeSingle();
  if (taskResult.error) return NextResponse.json({ error: "guardian_task_read_failed" }, { status: 503, headers: NO_STORE });
  if (!taskResult.data) return NextResponse.json({ error: "task_not_found" }, { status: 404, headers: NO_STORE });
  let revisionMatches: boolean | null = null;
  if (body.step !== undefined) {
    const stepResult = await supabase.from("regent_task_steps").select("step_number,revision")
      .eq("task_id", body.taskId).eq("user_id", auth.userId).eq("step_number", body.step).maybeSingle();
    if (stepResult.error) return NextResponse.json({ error: "guardian_step_read_failed" }, { status: 503, headers: NO_STORE });
    if (!stepResult.data) return NextResponse.json({ error: "step_not_found" }, { status: 404, headers: NO_STORE });
    revisionMatches = body.revision === undefined ? null : stepResult.data.revision === body.revision;
  }
  const sourceCommit = guardianSourceCommit();
  const payload = {
    kind: "external_guardian_review", version: "0.7.0", providerDeclared: body.provider,
    source: "human_supplied", transport: "human_import", providerIdentityVerified: false,
    automaticProviderExecutionVerified: false, grantsApproval: false,
    packetIdDeclared: body.packetId || null, sourceCommitDeclared: body.sourceCommit || null,
    deployedSourceCommit: sourceCommit,
    sourceCommitMatches: body.sourceCommit && sourceCommit ? body.sourceCommit === sourceCommit : null,
    step: body.step || null, revisionDeclared: body.revision || null, revisionMatches,
    taskControlRevision: taskResult.data.control_revision,
    review: sanitizeGuardianEvidence(body.review.trim()), recordedAt: new Date().toISOString(),
  };
  const saved = await supabase.from("regent_task_events").insert({ task_id: body.taskId,
    user_id: auth.userId, event_type: "guardian_review_imported", payload }).select("id,created_at").single();
  if (saved.error || !saved.data) return NextResponse.json({ error: "guardian_review_persist_failed", message: "O parecer não foi salvo; nenhuma fase foi aprovada." }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ review: { ...payload, id: saved.data.id, persistedAt: saved.data.created_at },
    message: "Parecer importado com origem humana declarada. Revise-o e use os controles de validação da fase; a importação não avançou a pipeline." }, { headers: NO_STORE });
}
