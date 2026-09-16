import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { orderCode } from '@/lib/order-code';
import { ORDER_STATUS_LABEL, orderStatusLabel } from '@/lib/order-status';

export const metadata: Metadata = { title: 'Área profissional' };

type OrderSummary = {
  id: string;
  order_number: number;
  status: string;
  total: number | null;
  created_at: string;
  updated_at: string;
  client_id: string;
  clients: { full_name: string } | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
}

export default async function ProfessionalPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (!isSupabaseConfigured()) {
    return <div className="page-shell narrow"><div className="setup-note">Configure as variáveis do Supabase para ativar a área profissional.</div></div>;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const [{ data: master }, { data: profile }] = await Promise.all([
    admin.from('system_admins').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle(),
    admin.from('professional_profiles').select('id, display_name, status, review_notes').eq('user_id', user.id).maybeSingle()
  ]);
  if (master) redirect('/admin');
  if (!profile || ['draft', 'changes_requested'].includes(profile.status)) redirect('/profissional/cadastro');
  if (profile.status !== 'approved') {
    const labels: Record<string, string> = {
      under_review: 'Seu cadastro está em análise pela equipe Optótica.',
      rejected: 'Seu cadastro não foi aprovado.',
      suspended: 'Seu acesso profissional está suspenso.'
    };
    return <div className="page-shell narrow"><div className="setup-note"><strong>{labels[profile.status] || 'Acesso indisponível.'}</strong>{profile.review_notes && <p>{profile.review_notes}</p>}</div></div>;
  }

  const params = await searchParams;
  const readParam = (key: string) => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value.trim() : '';
  };
  const paciente = readParam('paciente');
  const status = readParam('status');
  const de = readParam('de');
  const ate = readParam('ate');
  const filtersActive = Boolean(paciente || status || de || ate);

  // 16/09/2026 — correção da causa raiz da inconsistência reportada: esta
  // consulta usava `supabase` (sessão do usuário, sujeita a RLS) sem nenhum
  // filtro de `professional_id`. A tabela `orders` tem política de RLS
  // habilitada, mas só existem políticas de INSERT (`orders_add`) e UPDATE
  // (`orders_change`) — não existe NENHUMA política de SELECT (conferido em
  // todas as migrations rastreadas). Com RLS ativo e sem política de leitura,
  // a consulta sempre devolvia zero linhas, mesmo com pedidos reais no banco
  // — por isso "Meus pacientes" (que já usava `admin` + filtro explícito de
  // `professional_id`, igual a todas as outras consultas de `orders` deste
  // projeto) mostrava "Continuar atendimento" para pedidos que aqui apareciam
  // como "Nenhum pedido cadastrado". Corrigido para o mesmo padrão: `admin` +
  // `.eq('professional_id', user.id)`, que é o mecanismo real de autorização
  // usado em todo o restante do código (RLS nunca foi a proteção efetiva
  // desta tabela).
  //
  // Sobre "data de atendimento": nenhuma linha deste projeto, em nenhuma
  // migration rastreada, já selecionou ou usou uma coluna de data em
  // `orders` além de `updated_at` — a tabela é anterior ao histórico de
  // migrations rastreado. Confirmado com o usuário (16/09/2026, consulta a
  // information_schema.columns) o uso de `created_at` como "data de
  // atendimento" — a data em que o atendimento/pedido foi aberto. NÃO
  // presumimos silenciosamente `updated_at` como substituto — foi
  // explicitamente perguntado e confirmado antes de publicar.
  //
  // A mesma consulta também revelou que `orders_status_check` aceita bem
  // mais valores do que só 'in_progress'/'delivered' (ver
  // lib/order-status.ts) — o filtro de status abaixo lista todos eles,
  // ainda que só 'in_progress'/'delivered' sejam gravados por este app hoje.
  //
  // 16/09/2026, 2ª rodada (bug em produção, código PGRST201 nos logs da
  // Vercel): "clients(full_name)" sozinho é ambíguo pro PostgREST — a
  // consulta a pg_constraint que o usuário rodou só listou as constraints
  // DEFINIDAS em `orders` (conrelid = 'orders'), então não pegou nenhuma
  // constraint definida do lado de `clients` que também referencie `orders`
  // (ex.: um "pedido atual/ativo" salvo no cadastro do cliente) — com FKs
  // nos dois sentidos entre as duas tabelas, o PostgREST não sabe sozinho
  // qual usar pra montar o embed e erra com "more than one relationship was
  // found". Corrigido apontando explicitamente a constraint que sabemos que
  // existe (`orders_client_id_fkey`, confirmada na consulta anterior),
  // igual à sintaxe `tabela!nome_da_constraint(colunas)` do PostgREST.
  let query = admin
    .from('orders')
    .select('id, order_number, status, total, created_at, updated_at, client_id, clients!orders_client_id_fkey(full_name)')
    .eq('professional_id', user.id);

  if (status) query = query.eq('status', status);
  if (de) query = query.gte('created_at', `${de}T00:00:00`);
  if (ate) query = query.lte('created_at', `${ate}T23:59:59`);

  let patientFilterHadNoMatch = false;
  if (paciente) {
    const { data: matches } = await admin
      .from('professional_client_assignments')
      .select('client_id, clients!inner(full_name)')
      .eq('professional_user_id', user.id)
      .eq('active', true)
      .ilike('clients.full_name', `%${paciente}%`);
    const clientIds = (matches || []).map((m) => m.client_id);
    if (clientIds.length) {
      query = query.in('client_id', clientIds);
    } else {
      patientFilterHadNoMatch = true;
    }
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = patientFilterHadNoMatch ? { data: [] as OrderSummary[], error: null } : await query;
  const loadFailed = Boolean(error);
  if (error) console.error('professional_orders_load_failed', { code: error.code });
  const orders = (data || []) as unknown as OrderSummary[];

  return (
    <div className="page-shell">
      <section className="dashboard-head">
        <div><p className="eyebrow">Visão geral</p><h1>Olá, {profile.display_name.split(' ')[0]}.</h1><p className="muted">Acompanhe seus pedidos e retome os atendimentos.</p></div>
        <div className="workspace-actions">
          <Link className="button primary" href="/profissional/pacientes">Iniciar novo atendimento</Link>
          <Link className="button secondary" href="/profissional/pacientes/novo">Convidar paciente</Link>
        </div>
      </section>

      <section className="card table-card orders-table">
        <div className="workspace-section-title"><h2>Pedidos</h2><span>{loadFailed ? 'Carregamento indisponível' : `${orders.length} ${orders.length === 1 ? 'pedido listado' : 'pedidos listados'}${filtersActive ? ' com os filtros atuais' : ''}`}</span></div>
        <form className="filter-bar" method="get">
          <div className="field">
            <label htmlFor="f-paciente">Paciente</label>
            <input id="f-paciente" type="text" name="paciente" defaultValue={paciente} placeholder="Buscar por nome" />
          </div>
          <div className="field">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={status}>
              <option value="">Todos</option>
              {Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-de">Atendimento de</label>
            <input id="f-de" type="date" name="de" defaultValue={de} />
          </div>
          <div className="field">
            <label htmlFor="f-ate">Atendimento até</label>
            <input id="f-ate" type="date" name="ate" defaultValue={ate} />
          </div>
          <div className="filter-actions">
            <button className="button primary" type="submit">Filtrar</button>
            {filtersActive && <Link className="text-button" href="/profissional">Limpar filtros</Link>}
          </div>
        </form>

        <div className="table-head"><span>Pedido</span><span>Paciente</span><span>Atendimento</span><span>Status</span><span>Atualização</span></div>

        {loadFailed && (
          <div className="setup-note" style={{ margin: 20 }}>
            Não foi possível carregar a lista de pedidos agora. Tente novamente em instantes.
          </div>
        )}

        {!loadFailed && orders.length > 0 && orders.map((order) => (
          <div className="table-row" key={order.id}>
            <strong data-label="Pedido">{orderCode(order.clients?.full_name || 'Paciente', order.order_number)}</strong>
            <span data-label="Paciente">{order.clients?.full_name || 'Paciente'}</span>
            <time data-label="Atendimento" dateTime={order.created_at}>{formatDate(order.created_at)}</time>
            <Link className="status-link" href={`/profissional/pacientes/${order.client_id}/pedido/${order.id}`}>
              <span className="pill">{orderStatusLabel(order.status)}</span>
            </Link>
            <time data-label="Atualização" dateTime={order.updated_at}>{formatDate(order.updated_at)}</time>
          </div>
        ))}

        {!loadFailed && orders.length === 0 && (
          <div className="empty-state">
            {filtersActive ? 'Nenhum pedido encontrado para os filtros selecionados.' : 'Nenhum pedido cadastrado ainda.'}
          </div>
        )}
      </section>
    </div>
  );
}
