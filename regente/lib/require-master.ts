import { createAdminSupabaseClient, createServerSupabaseClient } from "./supabase";

export async function requireMaster() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      status: 401 as const,
      message: "Faça login como Master.",
    };
  }

  const admin = createAdminSupabaseClient();
  const { data: master, error } = await admin
    .from("system_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("regente_master_lookup_failed", {
      userId: user.id,
      message: error.message,
    });

    return {
      ok: false as const,
      status: 503 as const,
      message: "Não foi possível validar o acesso Master.",
    };
  }

  if (!master) {
    return {
      ok: false as const,
      status: 403 as const,
      message: "Acesso exclusivo do usuário Master.",
    };
  }

  return {
    ok: true as const,
    userId: user.id,
  };
}
