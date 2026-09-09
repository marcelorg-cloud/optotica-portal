import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Política de Privacidade' };

export default function PrivacyPolicyPage() {
  return (
    <div className="page-shell">
      <section className="card">
        <p className="eyebrow">Portal Optótica</p>
        <h1>Política de Privacidade</h1>
        <p className="muted">Última atualização: setembro de 2026.</p>

        <h2>1. Quem somos</h2>
        <p>
          O Portal Optótica conecta pacientes, profissionais de optometria e laboratórios de lentes.
          Esta política explica quais dados coletamos, para que usamos e quais direitos você tem sobre eles,
          em conformidade com a Lei Geral de Proteção de Dados (LGPD).
        </p>

        <h2>2. Dados que coletamos</h2>
        <p>
          De profissionais e responsáveis técnicos: nome, e-mail, telefone, número de registro profissional,
          dados de endereço e, quando aplicável, dados do laboratório principal utilizado.
        </p>
        <p>
          De pacientes: nome, número de WhatsApp e dados do atendimento vinculados ao profissional responsável.
          O vínculo entre paciente e profissional só é criado depois que o próprio paciente confirma o número de
          WhatsApp enviando a mensagem de confirmação do convite.
        </p>

        <h2>3. Como usamos o WhatsApp</h2>
        <p>
          Quando um profissional gera um convite de acesso, o paciente recebe um link para confirmar seu número
          oficial de WhatsApp. Ao enviar a mensagem de confirmação, coletamos o identificador da mensagem e o
          número que a enviou, exclusivamente para validar o convite, criar o acesso do paciente ao portal e
          enviar o link de acesso seguro. Não enviamos mensagens de marketing por esse canal.
        </p>

        <h2>4. Base legal e finalidade</h2>
        <p>
          Tratamos esses dados para viabilizar a prestação do serviço contratado (execução de contrato/consentimento),
          cumprir obrigações legais e regulatórias aplicáveis ao setor de saúde óptica, e proteger o acesso de cada
          usuário aos seus próprios dados.
        </p>

        <h2>5. Compartilhamento</h2>
        <p>
          Dados de orçamento e prescrição podem ser compartilhados com o laboratório escolhido pelo profissional,
          estritamente para a produção das lentes. Não vendemos dados pessoais a terceiros.
        </p>

        <h2>6. Retenção e segurança</h2>
        <p>
          Os dados ficam armazenados em infraestrutura com controle de acesso e criptografia em trânsito, pelo
          tempo necessário à prestação do serviço e ao cumprimento de obrigações legais.
        </p>

        <h2>7. Seus direitos</h2>
        <p>
          Você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados a qualquer momento,
          entrando em contato pelo e-mail abaixo.
        </p>

        <h2>8. Contato</h2>
        <p>
          Dúvidas sobre esta política ou sobre o tratamento dos seus dados podem ser enviadas para{' '}
          <a className="text-link" href="mailto:contato@optotica.com.br">contato@optotica.com.br</a>.
        </p>
      </section>
    </div>
  );
}
