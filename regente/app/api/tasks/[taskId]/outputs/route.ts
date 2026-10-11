import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";
import { buildArtifactOutputs } from "../../../../../lib/artifact-outputs";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "no-store" };
const MAX_ROWS = 1000;

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status, headers: HEADERS });
  const { taskId } = await params;
  const supabase = await createServerSupabaseClient();
  const task = await supabase.from("regent_tasks").select("id,title,status,engine_version")
    .eq("id", taskId).eq("user_id", auth.userId).maybeSingle();
  if (task.error || !task.data) return NextResponse.json({ error: "task_not_found", message: "Tarefa não encontrada." }, { status: task.error ? 500 : 404, headers: HEADERS });
  const fileRun = new URL(request.url).searchParams.get("fileRun");
  if (fileRun) {
    if (!/^[a-f0-9-]{36}$/i.test(fileRun)) return NextResponse.json({ error: "invalid_file" }, { status: 400, headers: HEADERS });
    const file = await supabase.from("regent_tool_runs").select("id,output").eq("id", fileRun).eq("task_id", taskId).eq("user_id", auth.userId)
      .eq("node_id", "F4").eq("adapter", "catalog_portal_standardize").eq("status", "succeeded").maybeSingle();
    if (file.error || !file.data) return NextResponse.json({ error: "file_not_found" }, { status: 404, headers: HEADERS });
    const catalog = (file.data.output as { catalog?: { sha256?: string } })?.catalog;
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return NextResponse.json({ error: "session_expired" }, { status: 401, headers: HEADERS });
    try {
      const portal = new URL(process.env.REGENT_PORTAL_ORIGIN || "https://app.optotica.com.br");
      if (portal.protocol !== "https:" || portal.username || portal.password || portal.pathname !== "/" || portal.search || portal.hash) throw new Error("invalid_portal_origin");
      const url = new URL("/api/internal/regente/catalog/file", portal.origin);
      url.searchParams.set("runId", fileRun);
      const response = await fetch(url, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return NextResponse.json({ error: "file_delivery_failed", message: "O Portal não liberou o arquivo. Revalide sessão, propriedade e integridade; não processe a foto novamente." }, { status: response.status, headers: HEADERS });
      const declaredLength = Number(response.headers.get("content-length"));
      if (response.headers.get("content-type")?.split(";")[0] !== "image/jpeg" || !Number.isInteger(declaredLength) || declaredLength <= 0 || declaredLength > 200 * 1024) throw new Error("invalid_file_contract");
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length !== declaredLength || createHash("sha256").update(buffer).digest("hex") !== catalog?.sha256) throw new Error("file_integrity_failed");
      return new Response(buffer, { headers: { ...HEADERS, "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff", "Content-Disposition": 'attachment; filename="catalogo-padronizado.jpg"' } });
    } catch { return NextResponse.json({ error: "file_delivery_unconfirmed", message: "Não foi possível confirmar o download. O output e o original continuam preservados." }, { status: 503, headers: HEADERS }); }
  }
  const [steps, runs, reviews] = await Promise.all([
    supabase.from("regent_task_steps").select("step_number,role,node_ids,status,artifact,revision,validated_at,completed_at,updated_at")
      .eq("task_id", taskId).eq("user_id", auth.userId).order("step_number").limit(MAX_ROWS),
    // Failed/running runs can contain confirmed partial external effects; never conceal them.
    supabase.from("regent_tool_runs").select("id,step_number,node_id,adapter,status,input,output,created_at,updated_at")
      .eq("task_id", taskId).eq("user_id", auth.userId).not("output", "is", null)
      .order("created_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("regent_phase_reviews").select("id,step_number,revision,decision,output,created_at")
      .eq("task_id", taskId).eq("user_id", auth.userId).eq("decision", "superseded")
      .order("created_at", { ascending: false }).limit(MAX_ROWS),
  ]);
  if (steps.error || runs.error || reviews.error) return NextResponse.json({ error: "outputs_failed", message: "Não foi possível ler os outputs preservados. Nenhum arquivo foi alterado." }, { status: 500, headers: HEADERS });
  const outputs = buildArtifactOutputs({ taskId, steps: steps.data || [], runs: runs.data || [], reviews: reviews.data || [] });
  const download = new URL(request.url).searchParams.get("download");
  if (download) {
    const item = outputs.find((output) => output.id === download);
    if (!item) return NextResponse.json({ error: "output_not_found" }, { status: 404, headers: HEADERS });
    return new Response("# " + task.data.title + "\n\nEtapa " + item.step + " · revisão " + item.revision + " · " + item.source + " · estado " + item.status + "\n\n" + item.fullContent, {
      headers: { ...HEADERS, "Content-Type": "text/markdown; charset=utf-8", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'attachment; filename="' + item.filename + '"' },
    });
  }
  return NextResponse.json({ task: { ...task.data,
    completedSteps: (steps.data || []).filter((step) => step.status === "succeeded").length,
    skippedSteps: (steps.data || []).filter((step) => step.status === "skipped").length,
    validatedSteps: (steps.data || []).filter((step) => step.validated_at != null).length,
    failedSteps: (steps.data || []).filter((step) => ["failed", "blocked"].includes(step.status)).length,
    totalSteps: steps.data?.length || 0, outputCount: outputs.length },
    items: outputs.map(({ fullContent: _full, ...item }) => item),
    historyLimitReached: [runs.data?.length, reviews.data?.length].some((count) => count === MAX_ROWS),
    limitations: ["Links de edição Canva não são arquivos exportados; acesso depende da conta e da permissão do design.",
      "Links em textos generativos não foram verificados como fontes."] }, { headers: HEADERS });
}
