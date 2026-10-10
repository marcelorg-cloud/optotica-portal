import { NextResponse } from "next/server";
import { requireMaster } from "../../../../lib/require-master";
import { collectOrchestraHealth, OrchestraReadError } from "../../../../lib/orchestra-health";
import { createServerSupabaseClient } from "../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET never probes providers or inserts a diagnostic. It only reads history.
export async function GET() {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "access_denied", message: auth.message }, { status: auth.status, headers: NO_STORE });
  const supabase = await createServerSupabaseClient();
  const latest = await supabase.from("regent_orchestra_checks")
    .select("id,report,created_at").eq("user_id", auth.userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) return NextResponse.json({ error: "orchestra_history_unavailable",
    message: "Não foi possível ler o histórico de afinamento. Confira o schema e as permissões da versão 0.7." },
  { status: 503, headers: NO_STORE });
  return NextResponse.json({ report: latest.data
    ? { ...latest.data.report, id: latest.data.id, persistedAt: latest.data.created_at } : null }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "access_denied", message: auth.message }, { status: auth.status, headers: NO_STORE });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers: NO_STORE });
  if (!request.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "json_required" }, { status: 415, headers: NO_STORE });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !["basic", "deep"].includes(body.depth) ||
      (body.taskId !== undefined && (typeof body.taskId !== "string" || !UUID.test(body.taskId))) ||
      (body.requiredNodes !== undefined && (!Array.isArray(body.requiredNodes) || body.requiredNodes.length > 24 ||
        body.requiredNodes.some((node: unknown) => typeof node !== "string" || !/^[AF][0-9]{1,2}$/.test(node))))) {
    return NextResponse.json({ error: "invalid_orchestra_request", message: "Informe profundidade basic/deep e uma missão válida, quando necessário." }, { status: 400, headers: NO_STORE });
  }
  const supabase = await createServerSupabaseClient();
  // A deep check is deliberately on demand and rate limited, not a heartbeat.
  // API identity endpoints have quotas even when no AI generation is performed.
  if (body.depth === "deep") {
    const last = await supabase.from("regent_orchestra_checks").select("id,report,created_at")
      .eq("user_id", auth.userId).eq("depth", "deep").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last.error) return NextResponse.json({ error: "orchestra_history_unavailable",
      message: "O histórico de segurança está indisponível; nenhum probe foi iniciado." }, { status: 503, headers: NO_STORE });
    if (last.data && Date.now() - new Date(last.data.created_at).getTime() < 60_000) {
      return NextResponse.json({ error: "orchestra_check_recent", message: "Um afinamento profundo foi feito há menos de um minuto. Consulte o relatório ou aguarde antes de repetir.",
        report: { ...last.data.report, id: last.data.id, persistedAt: last.data.created_at } },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    }
  }
  try {
    const session = body.depth === "deep" ? await supabase.auth.getSession() : null;
    const report = await collectOrchestraHealth({ supabase, userId: auth.userId, depth: body.depth,
      taskId: body.taskId, requiredNodes: body.requiredNodes,
      accessToken: session?.data.session?.access_token });
    const saved = await supabase.from("regent_orchestra_checks").insert({ user_id: auth.userId,
      depth: body.depth, status: report.summary.blockingCount || report.summary.attention || report.summary.unknown ? "attention" : "healthy", report })
      .select("id,created_at").single();
    if (saved.error || !saved.data) return NextResponse.json({ error: "orchestra_check_persist_failed",
      message: "O diagnóstico foi calculado, mas não foi salvo. Não o considere um checkpoint persistido.", report }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ report: { ...report, id: saved.data.id, persistedAt: saved.data.created_at } }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof OrchestraReadError ? error.code : "orchestra_check_failed",
      message: error instanceof OrchestraReadError ? error.message : "O afinamento não pôde ser concluído. Nenhuma autorização foi concedida." },
    { status: error instanceof OrchestraReadError && error.code === "task_not_found" ? 404 : 503, headers: NO_STORE });
  }
}
