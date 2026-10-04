import { NextResponse } from "next/server";
import { requireMaster } from "../../../../../lib/require-master";
import { createServerSupabaseClient } from "../../../../../lib/supabase";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireMaster();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.message },
      { status: auth.status },
    );
  }

  const { sessionId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: session, error: sessionError } = await supabase
    .from("regent_sessions")
    .select("id, title, budget_tier")
    .eq("id", sessionId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (sessionError || !session) {
    return NextResponse.json(
      { error: "session_not_found", message: "Conversa não encontrada." },
      { status: 404 },
    );
  }

  const { data: messages, error } = await supabase
    .from("regent_messages")
    .select("id, role, content, payload, created_at")
    .eq("session_id", sessionId)
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("regente_messages_load_failed", error);
    return NextResponse.json({ error: "messages_load_failed" }, { status: 500 });
  }

  return NextResponse.json({ session, messages: messages || [] });
}
