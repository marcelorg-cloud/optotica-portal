import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import {
  approveProfessionalAction,
  reactivateProfessionalAction,
  rejectProfessionalAction,
  requestChangesAction,
  suspendProfessionalAction
} from './actions';

export const metadata: Metadata = { title: 'Administração' };

type Laboratory = {
  id: string;
  name: string;
  legal_name: string | null;
  cnpj: string;
  address_line: string;
  address_number: string | null;
  city: string;
  state: string;
  phone_e164: string;
  status: string;
};

type ProfileReview = {
  id: string;
  display_name: string;
  email: string;
  account_type: string;
  status: string;
  council_registration: string | null;
  technical_responsible_name: string | null;
  technical_responsible_registration: string | null;
  legal_name: string | null;
  cnpj: string | null;
  address_line: string | null;
  address_number: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone_e164: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone_e164: string | null;
  submitted_at: string | null;
  review_notes: string | null;
  professional_laboratories: Laboratory[];
};

type AuditLogRow = {
  id: number;
  actor_type: string;
  action: string;
  entity_type: string;
  created_at: string;
};

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
}

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar?profissional=1');

  const admin = createAdminSupabaseClient();
  const { data: master } = await admin.from('system_admins').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!master) redirect('/profissional');

  const { data } = await admin
    .from('professional_profiles')
    .select(
      'id, display_name, email, account_type, status, legal_name, cnpj, council_registration, technical_responsible_name, technical_responsible_registration, address_line, address_number, district, city, state, postal_code, phone_e164, contact_name, contact_email, contact_phone_e164, submitted_at, review_notes, professional_laboratories(id, name, legal_name, cnpj, address_line, address_number, city, state, phone_e164, status)'
    )
    .order('submitted_at', { ascending: true, nullsFirst: false });
  const profiles = (data || []) as unknown as ProfileReview[];

  // audit_logs não tem política de leitura para o master global (só para
  // owner/admin da organização auditada) — usamos o client de service role
  // aqui, já depois de confirmar acima que este usuário é o master.
  const { data: auditData } = await admin
    .from('audit_logs')
    .select('id, actor_type, action, entity_type, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  const auditLogs = (auditData || []) as AuditLogRow[];

  return (
    <div className="page-shell">
      <section className="dashboard-head">
        <div><p className="eyebrow">Usuário master</p><h1>Aprovações</h1><p className="muted">Aprovar um cadastro libera o profissional, seus laboratórios e a geração de convites.</p></div>
      </section>
      <div className="review-list">
        {profiles.map((profile) => (
          <ProfileReviewCard key={profile.id} profile={profile} />
        ))}
        {!profiles.length && <div className="setup-note">Nenhum cadastro profissional recebido.</div>}
      </div>

      <h2 style={{ margin: '46px 0 16px', fontSize: 20, letterSpacing: '-.03em' }}>Auditoria recente</h2>
      <section className="card table-card">
        <div className="table-head"><span>Quando</span><span>Ação</span><span>Entidade</span><span>Ator</span></div>
        {auditLogs.length ? auditLogs.map((log) => (
          <div className="table-row" key={log.id}>
            <time>{formatDate(log.created_at)}</time>
            <span>{log.action}</span>
            <span>{log.entity_type}</span>
            <span className="pill">{log.actor_type}</span>
          </div>
        )) : <div className="empty-state">Nenhum registro de auditoria ainda.</div>}
      </section>
    </div>
  );
}

function ProfileReviewCard({ profile }: { profile: ProfileReview }) {
  const canApprove = ['draft', 'under_review', 'changes_requested'].includes(profile.status);
  const canRequestChanges = ['draft', 'under_review'].includes(profile.status);
  const canReject = ['draft', 'under_review', 'changes_requested'].includes(profile.status);
  const canSuspend = profile.status === 'approved';
  const canReactivate = profile.status === 'suspended';

  return (
    <article className="card review-card">
      <div className="review-title">
        <div>
          <span className="pill">{profile.status}</span>
          <h2>{profile.display_name}</h2>
          <p>{profile.email} · {profile.city || 'Cidade não informada'}/{profile.state || '--'}</p>
        </div>
        <div className="admin-actions">
          {canApprove && (
            <form action={approveProfessionalAction}>
              <input type="hidden" name="target_profile" value={profile.id} />
              <button className="button primary" type="submit">Aprovar</button>
            </form>
          )}
          {canRequestChanges && (
            <form action={requestChangesAction} className="stack" style={{ marginTop: 0 }}>
              <input type="hidden" name="target_profile" value={profile.id} />
              <textarea name="notes" placeholder="O que precisa ser corrigido?" required minLength={3} />
              <button className="button secondary" type="submit">Pedir ajustes</button>
            </form>
          )}
          {canReject && (
            <form action={rejectProfessionalAction} className="stack" style={{ marginTop: 0 }}>
              <input type="hidden" name="target_profile" value={profile.id} />
              <textarea name="notes" placeholder="Motivo da rejeição" required minLength={3} />
              <button className="text-button danger" type="submit">Rejeitar</button>
            </form>
          )}
          {canSuspend && (
            <form action={suspendProfessionalAction} className="stack" style={{ marginTop: 0 }}>
              <input type="hidden" name="target_profile" value={profile.id} />
              <textarea name="notes" placeholder="Motivo da suspensão" required minLength={3} />
              <button className="text-button danger" type="submit">Suspender</button>
            </form>
          )}
          {canReactivate && (
            <form action={reactivateProfessionalAction}>
              <input type="hidden" name="target_profile" value={profile.id} />
              <button className="button primary" type="submit">Reativar</button>
            </form>
          )}
        </div>
      </div>

      {profile.review_notes && <div className="setup-note" style={{ marginTop: 16 }}>Última observação: {profile.review_notes}</div>}

      <dl className="review-details">
        <div><dt>Tipo</dt><dd>{profile.account_type === 'optical_store' ? 'Ótica' : 'Profissional'}{profile.cnpj ? ` · CNPJ ${profile.cnpj}` : ''}</dd></div>
        <div><dt>Conselho</dt><dd>{profile.council_registration || 'Responsável técnico'}</dd></div>
        <div><dt>Responsável</dt><dd>{profile.technical_responsible_name || '—'} {profile.technical_responsible_registration || ''}</dd></div>
        <div><dt>Endereço</dt><dd>{profile.address_line || '—'}, {profile.address_number || 's/n'} · {profile.district || ''} · {profile.city}/{profile.state} · {profile.postal_code || ''}</dd></div>
        <div><dt>Telefone</dt><dd>{profile.phone_e164 || '—'}</dd></div>
        <div><dt>Contato</dt><dd>{profile.contact_name || '—'} · {profile.contact_email || ''} · {profile.contact_phone_e164 || ''}</dd></div>
      </dl>

      <div className="laboratory-summary">
        <strong>Laboratórios</strong>
        {profile.professional_laboratories?.length ? profile.professional_laboratories.map((lab) => (
          <span key={lab.id}>{lab.name}{lab.legal_name ? ` (${lab.legal_name})` : ''} · CNPJ {lab.cnpj} · {lab.address_line}, {lab.address_number || 's/n'} · {lab.city}/{lab.state} · {lab.phone_e164} · {lab.status}</span>
        )) : <span>Nenhum laboratório.</span>}
      </div>
    </article>
  );
}
