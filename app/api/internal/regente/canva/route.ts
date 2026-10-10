import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import {
  createRegentCanvaDesigns,
  inspectRegentCanvaDesigns,
  regentCanvaRunIsAuthorized,
  regentCanvaSourceIsValidated,
  type RegentCanvaProgress,
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
    spec.title.length > 0 && spec.title.length <= 100 &&
    Number.isInteger(spec.width) &&
    spec.width >= 320 &&
    spec.width <= 4000 &&
    Number.isInteger(spec.height) &&
    spec.height >= 320 &&
    spec.height <= 4000 &&
    Array.isArray(spec.pages) &&
    spec.pages.length >= 1 &&
    spec.pages.length <= 6 &&
    spec.pages.every((page) => page && typeof page.headline === "string" && page.headline.length > 0 && page.headline.length <= 180 &&
      [[page.eyebrow, 90], [page.body, 500], [page.cta, 80], [page.visualDirection, 260]].every(([text, maximum]) =>
        text === undefined || typeof text === "string" && text.length <= Number(maximum)))
  );
}

function failure(error: unknown, output?: unknown) {
  const status = error instanceof CanvaError ? error.status : 500;
  const message =
    error instanceof CanvaError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Não foi possível concluir a execução do Canva.";
  return NextResponse.json({ ...(output && typeof output === "object" ? output : {}), message }, { status, headers: { "Cache-Control": "no-store" } });
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

    const [masterResult, taskResult, stepResult] = await Promise.all([
      admin
        .from("system_admins")
        .select("user_id, active")
        .eq("user_id", toolRun.user_id)
        .eq("active", true)
        .maybeSingle(),
      admin
        .from("regent_tasks")
        .select("id,status,pipeline,human_decision,current_step,execution_id,execution_invocation_id,execution_lease_until")
        .eq("id", toolRun.task_id)
        .eq("user_id", toolRun.user_id)
        .maybeSingle(),
      admin.from("regent_task_steps").select("step_number,status,revision")
        .eq("task_id", toolRun.task_id).eq("user_id", toolRun.user_id).eq("step_number", toolRun.step_number).maybeSingle(),
    ]);

    if (masterResult.error || taskResult.error || stepResult.error) {
      throw new CanvaError("Não foi possível verificar a autorização da fase Canva.", 503);
    }
    const task = taskResult.data;
    if (!masterResult.data || !regentCanvaRunIsAuthorized({ task, step: stepResult.data, run: toolRun })) {
      return NextResponse.json({ message: "Esta invocação ou revisão da fase Canva não está autorizada. Atualize o monitor, sem repetir a criação." }, { status: 403 });
    }

    const input = (toolRun.input || {}) as {
      mode?: unknown;
      spec?: unknown;
      variants?: unknown;
      sourceRunIds?: unknown;
      designIds?: unknown;
    };
    const mode = input.mode === "inspect" ? "inspect" : "create";
    const canonicalPhase = Array.isArray(task?.pipeline) ? task.pipeline.find((phase) => phase?.step === toolRun.step_number) : null;
    if (!canonicalPhase || canonicalPhase.nodes?.[0] !== "F6" || canonicalPhase.canvaMode !== mode) {
      return NextResponse.json({ message: "A operação Canva não corresponde à fase autorizada na pipeline." }, { status: 403 });
    }
    if (mode === "inspect" && toolRun.adapter !== "canva_portal_inspect") {
      return NextResponse.json({ message: "Adapter de inspeção Canva inválido." }, { status: 403 });
    }
    if (mode === "create" && toolRun.adapter !== "canva_portal_bridge") {
      return NextResponse.json({ message: "Adapter de criação Canva inválido." }, { status: 403 });
    }
    if (mode === "create" && !validSpec(input.spec)) {
      return NextResponse.json({ message: "A especificação do design é inválida." }, { status: 422 });
    }

    const variants = Number(input.variants ?? 1);
    if (mode === "create" && (!Number.isInteger(variants) || variants < 1 || variants > 3)) {
      return NextResponse.json({ message: "Quantidade de variantes Canva inválida." }, { status: 422 });
    }
    let inspectedDesignIds: string[] = [];
    let expectedAccount: { userId: string; teamId: string } | undefined;
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
      if (sourceRunIds.some((id) => !canonicalPhase.canvaSourceRunIds?.includes(id)) ||
        requestedDesignIds.some((id) => !canonicalPhase.canvaDesignIds?.includes(id))) {
        return NextResponse.json({ message: "As referências Canva diferem da fase autorizada." }, { status: 403 });
      }

      const { data: sourceRuns, error: sourceRunsError } = await admin
        .from("regent_tool_runs")
        .select("id,task_id,user_id,node_id,step_number,status,input,output")
        .eq("user_id", toolRun.user_id)
        .eq("node_id", "F6")
        .eq("status", "succeeded")
        .in("id", sourceRunIds);
      if (sourceRunsError || !sourceRuns || sourceRuns.length !== sourceRunIds.length) {
        return NextResponse.json({ message: "Não foi possível comprovar a origem dos designs Canva." }, { status: 403 });
      }

      const sourceTaskIds = [...new Set(sourceRuns.map((run) => run.task_id))];
      const [tasksResult, phasesResult, reviewsResult] = await Promise.all([
        admin.from("regent_tasks").select("id,status,engine_version,validated_steps").eq("user_id", toolRun.user_id).in("id", sourceTaskIds),
        admin.from("regent_task_steps").select("task_id,step_number,status,revision,validated_at").eq("user_id", toolRun.user_id).in("task_id", sourceTaskIds),
        admin.from("regent_phase_reviews").select("task_id,step_number,revision,decision").eq("user_id", toolRun.user_id).in("task_id", sourceTaskIds),
      ]);
      if (tasksResult.error || phasesResult.error || reviewsResult.error || !tasksResult.data ||
        tasksResult.data.length !== sourceTaskIds.length || sourceRuns.some((run) => !regentCanvaSourceIsValidated({
          run, task: tasksResult.data.find((source) => source.id === run.task_id) || null,
          step: phasesResult.data?.find((phase) => phase.task_id === run.task_id && phase.step_number === run.step_number) || null,
          reviews: (reviewsResult.data || []).filter((review) => review.task_id === run.task_id),
        }))) {
        return NextResponse.json({ message: "Uma fase de origem Canva não foi validada, foi substituída ou pertence a outra revisão. Confira o output canônico." }, { status: 403 });
      }

      const allowedDesignIds = new Set(designIdsFromRegentRuns(sourceRuns));
      if (requestedDesignIds.some((designId) => !allowedDesignIds.has(designId))) {
        return NextResponse.json({ message: "Um design Canva solicitado não pertence aos resultados aprovados." }, { status: 403 });
      }
      inspectedDesignIds = requestedDesignIds;
      const accounts = sourceRuns.map((run) => (run.output as { account?: { userId?: unknown; teamId?: unknown } } | null)?.account)
        .filter((account): account is { userId: string; teamId: string } => typeof account?.userId === "string" && typeof account.teamId === "string");
      if (new Set(accounts.map((account) => account.userId + ":" + account.teamId)).size > 1) {
        return NextResponse.json({ message: "As referências Canva pertencem a contas ou equipes diferentes. Confira a conexão antes de inspecionar." }, { status: 403 });
      }
      expectedAccount = accounts[0];
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
      .eq("task_id", toolRun.task_id)
      .eq("user_id", toolRun.user_id)
      .eq("status", "pending")
      .eq("token_hash", tokenDigest)
      .gt("token_expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();

    if (claimError || !claimed) {
      return NextResponse.json({ message: "Esta execução já foi consumida." }, { status: 409 });
    }

    const runInput = toolRun.input as { stepRevision: number; executionId: string };
    const identity = { runId: toolRun.id, step: toolRun.step_number, revision: runInput.stepRevision, executionId: runInput.executionId };
    let progress: RegentCanvaProgress = { mode, designs: [], jobs: [], complete: false, externalEffect: "none" };
    async function assertAuthorized() {
      const [currentTask, currentPhase] = await Promise.all([
        admin.from("regent_tasks").select("status,human_decision,current_step,execution_id,execution_invocation_id,execution_lease_until")
          .eq("id", toolRun!.task_id).eq("user_id", toolRun!.user_id).maybeSingle(),
        admin.from("regent_task_steps").select("step_number,status,revision")
          .eq("task_id", toolRun!.task_id).eq("user_id", toolRun!.user_id).eq("step_number", toolRun!.step_number).maybeSingle(),
      ]);
      if (currentTask.error || currentPhase.error) throw new CanvaError("Não foi possível reconfirmar a autorização da fase. Nenhuma nova importação será iniciada.", 503);
      if (!regentCanvaRunIsAuthorized({ task: currentTask.data, step: currentPhase.data, run: toolRun! })) {
        throw new CanvaError("A invocação Canva foi substituída ou perdeu a autorização. Os jobs conhecidos foram preservados.", 409, "stale_canva_execution");
      }
    }
    async function onProgress(next: RegentCanvaProgress) {
      progress = next;
      const saved = await admin.from("regent_tool_runs").update({ output: { ...progress, ...identity }, updated_at: new Date().toISOString() })
        .eq("id", toolRun!.id).eq("task_id", toolRun!.task_id).eq("user_id", toolRun!.user_id).eq("status", "running").select("id").maybeSingle();
      if (saved.error || !saved.data) throw new CanvaError("Não foi possível persistir o progresso Canva. Confira o run original antes de retomar; não repita a criação.", 503, "canva_progress_not_persisted");
    }
    try {
      await assertAuthorized();
      const options = { onProgress, assertAuthorized, expectedAccount, deadline: Date.now() + 80_000 };
      const designs = mode === "inspect"
        ? await inspectRegentCanvaDesigns(admin, toolRun.user_id, inspectedDesignIds, options)
        : await createRegentCanvaDesigns(admin, toolRun.user_id, input.spec as RegentCanvaSpec, variants, options);
      if (!progress.complete || !Array.isArray(designs) || designs.length !== (mode === "inspect" ? inspectedDesignIds.length : variants) ||
        designs.some((design) => !design || typeof design.id !== "string" || typeof design.editUrl !== "string" || typeof design.viewUrl !== "string")) {
        throw new CanvaError("O Canva não confirmou todos os resultados esperados. Confira os designs e jobs preservados.", 502, "invalid_canva_bridge_output");
      }
      const output = { ...progress, ...identity, designs };
      const saved = await admin
        .from("regent_tool_runs")
        .update({ status: "succeeded", output, updated_at: new Date().toISOString() })
        .eq("id", toolRun.id).eq("task_id", toolRun.task_id).eq("user_id", toolRun.user_id).eq("status", "running").select("id").maybeSingle();
      if (saved.error || !saved.data) throw new CanvaError("Resultados Canva recebidos, mas a conclusão não foi persistida. Confira o run original; não repita a criação.", 503, "canva_result_not_persisted");
      return NextResponse.json(output, { headers: { "Cache-Control": "no-store" } });
    } catch (executionError) {
      const output = { ...progress, ...identity, complete: false,
        message: executionError instanceof Error ? executionError.message : "Falha Canva",
        code: executionError instanceof CanvaError ? executionError.code : "canva_execution_failed" };
      const saved = await admin
        .from("regent_tool_runs")
        .update({
          status: "failed",
          output,
          updated_at: new Date().toISOString(),
        })
        .eq("id", toolRun.id).eq("task_id", toolRun.task_id).eq("user_id", toolRun.user_id).eq("status", "running").select("id").maybeSingle();
      if (saved.error || !saved.data) return failure(new CanvaError("Falha ao persistir o diagnóstico Canva. Confira o run e os IDs informados antes de retomar; não repita a criação.", 503, "canva_failure_not_persisted"), output);
      return failure(executionError, output);
    }
  } catch (error) {
    return failure(error);
  }
}
