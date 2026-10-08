import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import {
  createRegentCanvaDesigns,
  inspectRegentCanvaDesigns,
  type RegentCanvaSpec,
} from "@/lib/canva/regent";
import { designIdsFromRegentRuns } from "@/lib/canva/regent-provenance";
import { CanvaError } from "@/lib/canva/security";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validSpec(value: unknown): value is RegentCanvaSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as RegentCanvaSpec;
  return (
    typeof spec.title === "string" &&
    spec.title.length > 0 &&
    Number.isInteger(spec.width) &&
    spec.width >= 320 &&
    spec.width <= 4000 &&
    Number.isInteger(spec.height) &&
    spec.height >= 320 &&
    spec.height <= 4000 &&
    Array.isArray(spec.pages) &&
    spec.pages.length >= 1 &&
    spec.pages.length <= 6 &&
    spec.pages.every((page) => page && typeof page.headline === "string" && page.headline.length > 0)
  );
}

function failure(error: unknown) {
  const status = error instanceof CanvaError ? error.status : 500;
  const message =
    error instanceof CanvaError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Não foi possível concluir a execução do Canva.";
  return NextResponse.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const admin = createAdminSupabaseClient();

  try {
    const body = await request.json().catch(() => null);
    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    const token = typeof body?.token === "string" ? body.token.trim() : "";

    if (!runId || !token || token.length > 256) {
      return NextResponse.json({ message: "Credencial de execução inválida." }, { status: 400 });
    }

    const tokenDigest = hash(token);
    const now = new Date().toISOString();
    const { data: toolRun, error } = await admin
      .from("regent_tool_runs")
      .select("id, task_id, user_id, node_id, step_number, adapter, status, input, token_hash, token_expires_at")
      .eq("id", runId)
      .eq("node_id", "F6")
      .eq("status", "pending")
      .eq("token_hash", tokenDigest)
      .gt("token_expires_at", now)
      .maybeSingle();

    if (error || !toolRun) {
      return NextResponse.json({ message: "Execução expirada, já utilizada ou inválida." }, { status: 403 });
    }

    const [{ data: master }, { data: task }] = await Promise.all([
      admin
        .from("system_admins")
        .select("user_id, active")
        .eq("user_id", toolRun.user_id)
        .eq("active", true)
        .maybeSingle(),
      admin
        .from("regent_tasks")
        .select("id, status, session_id")
        .eq("id", toolRun.task_id)
        .eq("user_id", toolRun.user_id)
        .maybeSingle(),
    ]);

    if (!master || !task || task.status !== "executing") {
      return NextResponse.json({ message: "A execução não está autorizada." }, { status: 403 });
    }

    const input = (toolRun.input || {}) as {
      mode?: unknown;
      spec?: unknown;
      variants?: unknown;
      sourceRunIds?: unknown;
      designIds?: unknown;
    };
    const mode = input.mode === "inspect" ? "inspect" : "create";
    if (mode === "inspect" && toolRun.adapter !== "canva_portal_inspect") {
      return NextResponse.json({ message: "Adapter de inspeção Canva inválido." }, { status: 403 });
    }
    if (mode === "create" && toolRun.adapter !== "canva_portal_bridge") {
      return NextResponse.json({ message: "Adapter de criação Canva inválido." }, { status: 403 });
    }
    if (mode === "create" && !validSpec(input.spec)) {
      return NextResponse.json({ message: "A especificação do design é inválida." }, { status: 422 });
    }

    const variants = Math.max(1, Math.min(3, Number(input.variants || 1)));
    let inspectedDesignIds: string[] = [];
    if (mode === "inspect") {
      const sourceRunIds = Array.isArray(input.sourceRunIds)
        ? [...new Set(input.sourceRunIds.filter((value): value is string => typeof value === "string"))]
        : [];
      const requestedDesignIds = Array.isArray(input.designIds)
        ? [...new Set(input.designIds.filter((value): value is string => typeof value === "string"))]
        : [];
      if (!sourceRunIds.length || !requestedDesignIds.length || sourceRunIds.length > 20 || requestedDesignIds.length > 10) {
        return NextResponse.json({ message: "Referências canônicas do Canva ausentes ou inválidas." }, { status: 422 });
      }

      const { data: sourceRuns, error: sourceRunsError } = await admin
        .from("regent_tool_runs")
        .select("id, task_id, user_id, node_id, status, output")
        .eq("user_id", toolRun.user_id)
        .eq("node_id", "F6")
        .eq("status", "succeeded")
        .in("id", sourceRunIds);
      if (sourceRunsError || !sourceRuns || sourceRuns.length !== sourceRunIds.length) {
        return NextResponse.json({ message: "Não foi possível comprovar a origem dos designs Canva." }, { status: 403 });
      }

      const sourceTaskIds = [...new Set(sourceRuns.map((run) => run.task_id))];
      const { data: sourceTasks, error: sourceTasksError } = await admin
        .from("regent_tasks")
        .select("id, session_id")
        .eq("user_id", toolRun.user_id)
        .in("id", sourceTaskIds);
      if (
        sourceTasksError ||
        !sourceTasks ||
        sourceTasks.length !== sourceTaskIds.length ||
        sourceTasks.some((sourceTask) => sourceTask.session_id !== task.session_id)
      ) {
        return NextResponse.json({ message: "Os designs Canva não pertencem a esta missão." }, { status: 403 });
      }

      const allowedDesignIds = new Set(designIdsFromRegentRuns(sourceRuns));
      if (requestedDesignIds.some((designId) => !allowedDesignIds.has(designId))) {
        return NextResponse.json({ message: "Um design Canva solicitado não pertence aos resultados aprovados." }, { status: 403 });
      }
      inspectedDesignIds = requestedDesignIds;
    }

    const { data: claimed, error: claimError } = await admin
      .from("regent_tool_runs")
      .update({
        status: "running",
        token_hash: null,
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", toolRun.id)
      .eq("status", "pending")
      .eq("token_hash", tokenDigest)
      .select("id")
      .maybeSingle();

    if (claimError || !claimed) {
      return NextResponse.json({ message: "Esta execução já foi consumida." }, { status: 409 });
    }

    try {
      const designs = mode === "inspect"
        ? await inspectRegentCanvaDesigns(admin, toolRun.user_id, inspectedDesignIds)
        : await createRegentCanvaDesigns(admin, toolRun.user_id, input.spec as RegentCanvaSpec, variants);
      const output = { mode, designs };
      await admin
        .from("regent_tool_runs")
        .update({ status: "succeeded", output, updated_at: new Date().toISOString() })
        .eq("id", toolRun.id);
      return NextResponse.json(output, { headers: { "Cache-Control": "no-store" } });
    } catch (executionError) {
      await admin
        .from("regent_tool_runs")
        .update({
          status: "failed",
          output: { message: executionError instanceof Error ? executionError.message : "Falha Canva" },
          updated_at: new Date().toISOString(),
        })
        .eq("id", toolRun.id);
      throw executionError;
    }
  } catch (error) {
    return failure(error);
  }
}
