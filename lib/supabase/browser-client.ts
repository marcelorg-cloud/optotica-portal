'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

// Cliente mínimo do Supabase para uso no navegador — hoje serve só para
// enviar arquivos direto ao Storage usando uma URL de upload assinada
// (createSignedUploadUrl, gerada pelo servidor com a service role). Não lida
// com sessão/cookies de autenticação (isso continua sendo feito só no
// servidor, via @supabase/ssr em lib/supabase/server.ts) — a autorização do
// upload em si já vem embutida no token assinado, então a chave publishable
// (anon) aqui é suficiente e segura de expor no navegador.
let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(publicEnv.supabaseUrl(), publicEnv.supabasePublishableKey());
  }
  return cached;
}
