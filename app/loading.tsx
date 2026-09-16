export default function Loading() {
  return <div className="processing-pill" role="status" aria-live="polite" style={{ width: 'fit-content', margin: '48px auto' }}>
    <span className="processing-spinner" aria-hidden="true" />
    <span><strong>Carregando página…</strong><small>Aguarde um instante.</small></span>
  </div>;
}
