import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Para visionários como você</p>
          <h1>A conexão do universo ótico optométrico.</h1>
          <p className="lead">
            Entre no portal da inovação Optótica e veja a realidade digital a seu favor.
          </p>
          <div className="actions">
            <Link className="button primary" href="/entrar">Acessar pelo WhatsApp</Link>
            <Link className="button secondary" href="/profissional">Sou profissional</Link>
          </div>
        </div>
        <div className="hero-panel" aria-label="Fluxo do portal">
          {['Atendimento', 'Prescrição', 'Orçamento', 'Produção', 'Entrega'].map((item, index) => (
            <div className="flow-row" key={item}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{item}</strong>
              <small>{index < 4 ? 'Próxima etapa' : 'Pedido concluído'}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="feature-grid" aria-label="Recursos">
        <article><span>01</span><h2>Dados organizados</h2><p>Clientes, receitas e pedidos vinculados à empresa correta.</p></article>
        <article><span>02</span><h2>Acesso controlado</h2><p>Permissões por empresa, unidade, profissional e cliente.</p></article>
        <article><span>03</span><h2>Acompanhamento claro</h2><p>Orçamentos, armações, produção e entrega em uma linha do tempo.</p></article>
      </section>
    </div>
  );
}
