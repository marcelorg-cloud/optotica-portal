import { createBearerSupabaseClient, createServerSupabaseClient } from "./supabase";

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

  // system_admins tem RLS system_admins_self_read:
  // authenticated pode ler somente sua própria linha (user_id = auth.uid()).
  // Assim, a validação Master não precisa de service role/secret key.
  const { data: master, error } = await supabase
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


export async function requireMasterBearer(accessToken: string) {
  if (!accessToken) {
    return {
      ok: false as const,
      status: 401 as const,
      message: "Sessão Master ausente para a execução durável.",
    };
  }

  const supabase = createBearerSupabaseClient(accessToken);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return {
      ok: false as const,
      status: 401 as const,
      message: "Sessão Master inválida ou expirada.",
    };
  }

  const { data: master, error } = await supabase
    .from("system_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("regente_workflow_master_lookup_failed", {
      userId: user.id,
      message: error.message,
    });

    return {
      ok: false as const,
      status: 503 as const,
      message: "Não foi possível validar o acesso Master da execução durável.",
    };
  }

  if (!master) {
    return {
      ok: false as const,
      status: 403 as const,
      message: "Execução durável restrita ao usuário Master.",
    };
  }

  return {
    ok: true as const,
    userId: user.id,
  };
}
