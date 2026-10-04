import { NextResponse } from "next/server";
import { requireMaster } from "../../../lib/require-master";
import { createServerSupabaseClient } from "../../../lib/supabase";

export async function GET() {
  const auth = await requireMaster();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden", message: auth.message },
      { status: auth.status },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("regent_sessions")
    .select("id, title, budget_tier, created_at, updated_at")
    .eq("user_id", auth.userId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("regente_sessions_list_failed", error);
    return NextResponse.json({ error: "sessions_load_failed" }, { status: 500 });
  }

  return NextResponse.json({ sessions: data || [] });
}
