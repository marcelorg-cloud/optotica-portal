import { NextResponse } from "next/server";
import { askRegent, type RegentConversationMessage } from "../../../lib/regente";
import { requireMaster } from "../../../lib/require-master";
import { createServerSupabaseClient } from "../../../lib/supabase";
import { initializeTaskSteps, syncTaskProgress } from "../../../lib/task-state";

export const runtime = "nodejs";

const MAX_HISTORY_MESSAGES = 16;

function makeTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= 56) return normalized;
  return `${normalized.slice(0, 53).trimEnd()}...`;
}

export async function POST(request: Request) {
  const auth = await requireMaster();

  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.message },
      { status: auth.status },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "setup_required", message: "OPENAI_API_KEY ainda não foi configurada no ambiente do Regente." },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const budgetTier = ["minimal", "controlled", "flexible"].includes(body.budgetTier)
      ? body.budgetTier
      : "minimal";

    if (!message) {
      return NextResponse.json({ error: "message_required" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    let sessionId = requestedSessionId;
    let isNewSession = false;

    if (sessionId) {
      const { data: session, error: sessionError } = await supabase
        .from("regent_sessions")
        .select("id, budget_tier")
        .eq("id", sessionId)
        .eq("user_id", auth.userId)
        .maybeSingle();

      if (sessionError || !session) {
        return NextResponse.json(
          { error: "session_not_found", message: "Conversa não encontrada." },
          { status: 404 },
        );
      }
    } else {
      const { data: session, error: sessionError } = await supabase
        .from("regent_sessions")
        .insert({ user_id: auth.userId, title: makeTitle(message), budget_tier: budgetTier })
        .select("id")
        .single();

      if (sessionError || !session) {
        console.error("regente_session_create_failed", sessionError);
        return NextResponse.json(
          { error: "session_create_failed", message: "Não foi possível iniciar a conversa." },
          { status: 500 },
        );
      }

      sessionId = session.id;
      isNewSession = true;
    }

    const { data: previousMessages, error: historyError } = await supabase
      .from("regent_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(MAX_HISTORY_MESSAGES);

    if (historyError) {
      console.error("regente_history_load_failed", historyError);
      return NextResponse.json(
        { error: "history_load_failed", message: "Não foi possível recuperar o histórico." },
        { status: 500 },
      );
    }

    const history = ((previousMessages || []).reverse() as RegentConversationMessage[]);

    const { data: savedUserMessage, error: userMessageError } = await supabase
      .from("regent_messages")
      .insert({ session_id: sessionId, user_id: auth.userId, role: "user", content: message })
      .select("id")
      .single();

    if (userMessageError || !savedUserMessage) {
      console.error("regente_user_message_save_failed", userMessageError);
      return NextResponse.json(
        { error: "message_save_failed", message: "Não foi possível salvar sua mensagem." },
        { status: 500 },
      );
    }

    let output;
    try {
      output = await askRegent({ message, history, budgetTier });
    } catch (error) {
      await supabase
        .from("regent_messages")
        .delete()
        .eq("id", savedUserMessage.id)
        .eq("user_id", auth.userId);
      throw error;
    }

    if (!output) {
      await supabase
        .from("regent_messages")
        .delete()
        .eq("id", savedUserMessage.id)
        .eq("user_id", auth.userId);
      throw new Error("Regente retornou output vazio.");
    }

    const taskStatus = output.approvalRequired ? "awaiting_approval" : "approved";
    const { data: task, error: taskError } = await supabase
      .from("regent_tasks")
      .insert({
        user_id: auth.userId,
        session_id: sessionId,
        title: output.taskTitle,
        objective: output.objective,
        status: taskStatus,
        depth: output.depth,
        risk: output.risk,
        budget_tier: budgetTier,
        pipeline: output.pipeline,
        picker: output.picker,
        next_action: output.nextAction,
        autonomy_level: output.autonomyLevel,
      })
      .select("id, status")
      .single();

    if (taskError || !task) {
      console.error("regente_task_save_failed", taskError);
      return NextResponse.json(
        { error: "task_save_failed", message: "O plano foi gerado, mas não pôde ser registrado." },
        { status: 500 },
      );
    }

    await initializeTaskSteps({
      supabase,
      taskId: task.id,
      userId: auth.userId,
      pipeline: output.pipeline,
      approvalRequired: output.approvalRequired,
    });
    await syncTaskProgress({ supabase, taskId: task.id, userId: auth.userId, fallbackNextAction: output.nextAction });

    await supabase.from("regent_task_events").insert({
      task_id: task.id,
      user_id: auth.userId,
      event_type: "pipeline_planned",
      payload: {
        depth: output.depth,
        risk: output.risk,
        selectedNodes: output.selectedNodes,
        pipeline: output.pipeline,
        picker: output.picker,
      },
    });

    const assistantMessage =
      output.message?.trim() ||
      output.summary?.trim() ||
      "O Regente concluiu a análise, mas não retornou uma mensagem textual.";

    const persistedPayload = { ...output, taskId: task.id, taskStatus: task.status };

    const { error: assistantMessageError } = await supabase
      .from("regent_messages")
      .insert({
        session_id: sessionId,
        user_id: auth.userId,
        role: "assistant",
        content: assistantMessage,
        payload: persistedPayload,
      });

    if (assistantMessageError) {
      console.error("regente_assistant_message_save_failed", assistantMessageError);
      return NextResponse.json(
        { error: "response_save_failed", message: "A resposta foi gerada, mas não pôde ser salva." },
        { status: 500 },
      );
    }

    await supabase
      .from("regent_sessions")
      .update({ updated_at: new Date().toISOString(), budget_tier: budgetTier })
      .eq("id", sessionId)
      .eq("user_id", auth.userId);

    return NextResponse.json({
      mode: "supervised_pipeline",
      version: "0.5",
      sessionId,
      isNewSession,
      taskId: task.id,
      taskStatus: task.status,
      message: assistantMessage,
      output: persistedPayload,
    });
  } catch (error) {
    console.error("Regente error", error);
    return NextResponse.json(
      { error: "regent_failed", message: "Falha ao consultar o Regente." },
      { status: 500 },
    );
  }
}
