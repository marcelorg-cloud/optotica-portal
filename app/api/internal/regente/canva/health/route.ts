import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { api } from "@/lib/canva/api";
import { CanvaError, config, configurationStatus, decrypt } from "@/lib/canva/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const NO_STORE = { "Cache-Control": "no-store" };

// Read-only identity diagnosis. Uses the same verified Master session as the
// Regente, not a new shared secret or an ambient service-role bypass. Expired
// tokens are reported; this route never refreshes OAuth or mutates a connection.
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = /^Bearer [A-Za-z0-9._~-]{30,8192}$/.test(authorization)
    ? authorization.slice(7) : null;
  if (!accessToken) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    const authenticated = createClient(publicEnv.supabaseUrl(), publicEnv.supabasePublishableKey(), {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data: { user }, error: authError } = await authenticated.auth.getUser(accessToken);
    if (authError || !user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    const master = await authenticated.from("system_admins").select("user_id")
      .eq("user_id", user.id).eq("active", true).maybeSingle();
    if (master.error) return NextResponse.json({ error: "master_validation_unavailable" }, { status: 503, headers: NO_STORE });
    if (!master.data) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });

    const settings = configurationStatus();
    const baseline = { configured: settings.configured, clientId: settings.configured ? config().clientId : null,
      authenticated: null as boolean | null,
      authorized: null as boolean | null, operational: null as boolean | null,
      identity: null as { userId: string; teamId: string } | null, identityMatchesStored: null as boolean | null,
      tokenState: "not_checked", financial: "not_verified", planPro: "not_verified",
      verifiedOperations: [] as string[], detail: "", action: null as string | null };
    if (!settings.configured) return NextResponse.json({ canva: { ...baseline,
      operational: false, detail: settings.error || "Configuração Canva incompleta no Portal.",
      action: "Conferir Client ID, Client Secret, origem e chave de proteção no projeto Portal e publicar." } }, { headers: NO_STORE });

    // canva_connections is intentionally service-only. The operator has been
    // verified above; this privileged read is narrowly scoped to their own row.
    const admin = createAdminSupabaseClient();
    const connection = await admin.from("canva_connections")
      .select("canva_user_id,canva_team_id,expires_at,access_token").eq("user_id", user.id).maybeSingle();
    if (connection.error) return NextResponse.json({ error: "canva_connection_read_failed" }, { status: 503, headers: NO_STORE });
    if (!connection.data) return NextResponse.json({ canva: { ...baseline, configured: true,
      authenticated: false, operational: false, tokenState: "absent",
      detail: "Nenhuma conexão Canva preservada para este operador no Portal.",
      action: "No Portal, use Trocar conta Canva e autorize a nova conta/equipe desejada." } }, { headers: NO_STORE });

    const storedIdentity = { userId: connection.data.canva_user_id, teamId: connection.data.canva_team_id };
    if (!Number.isFinite(new Date(connection.data.expires_at).getTime()) ||
      new Date(connection.data.expires_at).getTime() <= Date.now() + 60_000) {
      return NextResponse.json({ canva: { ...baseline, configured: true, identity: storedIdentity,
        tokenState: "expired", detail: "Token de acesso expirado ou próximo do vencimento. O diagnóstico não o renovou e isso não prova que o refresh token seja inválido.",
        action: "Abrir o Portal para validar/renovar a conexão normal; depois executar o afinamento novamente. Se houver erro OAuth, reconectar a conta." } }, { headers: NO_STORE });
    }
    try {
      const token = decrypt(connection.data.access_token, config().encryptionKey, user.id + ":access");
      const body = await api<{ team_user: { user_id: string; team_id: string } }>(token, "/users/me");
      if (!body?.team_user || typeof body.team_user.user_id !== "string" || typeof body.team_user.team_id !== "string") {
        return NextResponse.json({ error: "canva_identity_response_invalid" }, { status: 502, headers: NO_STORE });
      }
      const identity = { userId: body.team_user.user_id, teamId: body.team_user.team_id };
      const identityMatchesStored = identity.userId === storedIdentity.userId && identity.teamId === storedIdentity.teamId;
      return NextResponse.json({ canva: { ...baseline, configured: true, authenticated: true,
        authorized: identityMatchesStored, operational: identityMatchesStored, tokenState: "current",
        identity, identityMatchesStored, verifiedOperations: ["identity_read"],
        detail: identityMatchesStored
          ? "Identidade OAuth Canva lida e consistente com a conexão do Portal compartilhada pelo Regente. Permissões de criação/exportação e plano Pro não foram testados por este probe."
          : "A identidade do token diverge do usuário/equipe preservados. Nenhuma conexão ou arquivo foi alterado.",
        action: identityMatchesStored ? null : "Reconectar a conta Canva correta no Portal e conferir usuário/equipe antes de criar novos outputs." } }, { headers: NO_STORE });
    } catch (error) {
      const invalid = error instanceof CanvaError && error.status === 401;
      const forbidden = error instanceof CanvaError && error.status === 403;
      return NextResponse.json({ canva: { ...baseline, configured: true, identity: storedIdentity,
        authenticated: invalid ? false : null, authorized: forbidden ? false : null,
        operational: invalid || forbidden ? false : null, tokenState: invalid ? "invalid" : "not_checked",
        detail: invalid ? "O token Canva não foi aceito na verificação de identidade."
          : forbidden ? "O Canva recusou a leitura de identidade para esta conexão."
          : "A identidade Canva não pôde ser confirmada por rede, limite, resposta ou credencial local. Nenhuma alteração foi efetuada.",
        action: invalid || forbidden ? "Reconectar a conta no Portal; conferir aplicação, usuário e equipe." : "Conferir disponibilidade e repetir o afinamento; não regenerar designs para testar." } }, { headers: NO_STORE });
    }
  } catch {
    return NextResponse.json({ error: "canva_health_unavailable", message: "O diagnóstico Canva está indisponível; nenhum segredo ou resposta bruta foi exposto." }, { status: 503, headers: NO_STORE });
  }
}
