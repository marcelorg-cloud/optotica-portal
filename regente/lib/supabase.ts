import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const DEFAULT_SUPABASE_URL = "https://xepkdqcbjrictowriccb.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_F-DN3Z4GZbX5j2IeXtq5cw_rJHP6mfw";

export function publicSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
}

export function publicSupabaseKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY
  );
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


export function createBearerSupabaseClient(accessToken: string) {
  return createClient(publicSupabaseUrl(), publicSupabaseKey(), {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createAuthSupabaseClient() {
  return createClient(publicSupabaseUrl(), publicSupabaseKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
