import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function publicSupabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurado.");
  return value;
}

function publicSupabaseKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY não configurado.");
  return value;
}

function secretSupabaseKey() {
  const value = process.env.SUPABASE_SECRET_KEY;
  if (!value) throw new Error("SUPABASE_SECRET_KEY não configurado.");
  return value;
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(publicSupabaseUrl(), publicSupabaseKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components podem não conseguir gravar cookies.
          // O proxy atualiza a sessão nas requisições seguintes.
        }
      },
    },
  });
}

export function createAdminSupabaseClient() {
  return createClient(publicSupabaseUrl(), secretSupabaseKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
