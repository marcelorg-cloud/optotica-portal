// Fluxo de mensagens de WhatsApp por estágio do atendimento (16/09/2026).
//
// Especificação recebida do usuário (colada verbatim, elaborada com apoio de
// ChatGPT) — resumo das regras que este arquivo implementa:
//  - Só UMA das quatro mensagens é escolhida por vez: a do estágio mais
//    avançado já efetivamente salvo no atendimento (nunca as quatro em
//    sequência, nunca com base só nas páginas que o paciente abriu).
//  - Sem temporizador, sem IA, sem retomada automática: o profissional
//    sempre decide e confirma cada envio (ver o botão "Enviar" na rota de
//    API que usa este arquivo).
//  - Desconto/cupom só pode aparecer quando existir uma vantagem registrada
//    — nesta fase, isso significa exclusivamente `client.is_test_patient`
//    (descontos genéricos, só para pacientes de teste, nunca reais).
//
// Mecânica de botão/link finalizada com o usuário: TODO botão (inclusive
// "Ver prescrição" e "Fazer pagamento") é um botão de RESPOSTA rápida do
// WhatsApp expressando intenção (nunca um botão que abre link direto) — a
// plataforma só permite um çou outro numa mesma mensagem interativa, nunca
// os dois. Ao tocar, o paciente recebe uma segunda mensagem, automática,
// só de texto, com o link/conteúdo real (ver o tratamento de toque em botão
// em app/api/webhooks/whatsapp/route.ts). Essa segunda mensagem é reação
// direta a um toque explícito do paciente, não um disparo por conta própria
// do sistema — por isso não fere a regra "nenhum envio sem confirmação do
// profissional" (que vale para a mensagem de estágio em si).

export type WhatsAppStageId =
  | 'prescricao_disponivel'
  | 'orcamento_selecionado'
  | 'pedido_completo'
  | 'pagamento_confirmado';

export const WHATSAPP_STAGE_LABEL: Record<WhatsAppStageId, string> = {
  prescricao_disponivel: 'Prescrição disponível, sem compra',
  orcamento_selecionado: 'Orçamentos e modelos selecionados',
  pedido_completo: 'Pedido completo, aguardando pagamento',
  pagamento_confirmado: 'Pedido com pagamento confirmado'
};

export interface WhatsAppStageInputs {
  prescriptionDone: boolean;
  /** Orçamento selecionado (Lentes sugeridas) OU armação escolhida (Etapa 4/Carrinho). */
  quoteOrFrameChosen: boolean;
  /** Comanda final confirmada (order_fulfillment.comanda_confirmed_at). */
  comandaDone: boolean;
  /** Pagamento confirmado (order_fulfillment.payment_confirmed_at). */
  paymentDone: boolean;
}

/**
 * Estágio mais avançado já efetivamente salvo no atendimento — nunca deriva
 * de páginas abertas pelo paciente, só do que está gravado no banco (regra
 * explícita do usuário). Retorna null quando nem a prescrição existe ainda
 * (nenhuma das quatro mensagens se aplica).
 */
export function computeWhatsAppStage(inputs: WhatsAppStageInputs): WhatsAppStageId | null {
  if (inputs.paymentDone) return 'pagamento_confirmado';
  if (inputs.comandaDone) return 'pedido_completo';
  if (inputs.quoteOrFrameChosen) return 'orcamento_selecionado';
  if (inputs.prescriptionDone) return 'prescricao_disponivel';
  return null;
}

export type WhatsAppButtonId = 'ver_prescricao' | 'ganhar_cupom' | 'sim_reenviar' | 'agora_nao' | 'fazer_pagamento';

export interface WhatsAppButtonDef {
  id: WhatsAppButtonId;
  /** WhatsApp limita o título de um botão de resposta a 20 caracteres. */
  title: string;
}

export interface WhatsAppStagePreview {
  body: string;
  buttons: WhatsAppButtonDef[];
}

function firstName(clientName: string) {
  return clientName.trim().split(/\s+/)[0] || clientName;
}

/**
 * Monta o texto e os botões da mensagem de estágio — nenhum link aparece
 * aqui (mecânica finalizada com o usuário, ver comentário no topo do
 * arquivo). "Ganhar cupom" só entra quando `isTestPatient` é true (regra:
 * desconto/cupom exige vantagem registrada, e nesta fase isso é só para
 * pacientes de teste — nunca oferecer condição fictícia a paciente real).
 */
export function buildWhatsAppStagePreview(stage: WhatsAppStageId, params: { clientName: string; isTestPatient: boolean }): WhatsAppStagePreview {
  const name = firstName(params.clientName);
  switch (stage) {
    case 'prescricao_disponivel': {
      const buttons: WhatsAppButtonDef[] = [{ id: 'ver_prescricao', title: 'Ver prescrição' }];
      if (params.isTestPatient) buttons.push({ id: 'ganhar_cupom', title: 'Ganhar cupom' });
      const body = params.isTestPatient
        ? `Olá, ${name}! Sua prescrição já está disponível no Portal Optótica. Toque no botão abaixo para receber o link de acesso, ou veja como ganhar um cupom de desconto especial.`
        : `Olá, ${name}! Sua prescrição já está disponível no Portal Optótica. Toque no botão abaixo para receber o link de acesso.`;
      return { body, buttons };
    }
    case 'orcamento_selecionado': {
      const buttons: WhatsAppButtonDef[] = [
        { id: 'sim_reenviar', title: 'Sim, reenviar' },
        { id: 'agora_nao', title: 'Agora não' },
        { id: 'ver_prescricao', title: 'Ver prescrição' }
      ];
      const body = params.isTestPatient
        ? `Olá, ${name}! Já preparamos um orçamento e um modelo de armação para você, com uma condição especial aplicada. Quer receber os orçamentos atualizados agora?`
        : `Olá, ${name}! Já preparamos um orçamento e um modelo de armação para você. Quer receber os orçamentos atualizados agora?`;
      return { body, buttons };
    }
    case 'pedido_completo': {
      const buttons: WhatsAppButtonDef[] = [
        { id: 'fazer_pagamento', title: 'Fazer pagamento' },
        { id: 'ver_prescricao', title: 'Ver prescrição' }
      ];
      const body = `Olá, ${name}! Seu pedido está completo, faltando só o pagamento para seguir para a produção. Toque no botão abaixo para aproveitar as condições especiais disponíveis agora.`;
      return { body, buttons };
    }
    case 'pagamento_confirmado': {
      const buttons: WhatsAppButtonDef[] = [{ id: 'ver_prescricao', title: 'Ver prescrição' }];
      const body = `Olá, ${name}! Recebemos a confirmação do seu pagamento — muito obrigado! As próximas etapas do seu pedido serão avisadas por aqui, pelo WhatsApp.`;
      return { body, buttons };
    }
  }
}

/** A qual seção existente da área do paciente (app/cliente/pedido/[orderId]) cada botão deve levar. */
export const WHATSAPP_BUTTON_SECTION: Record<WhatsAppButtonId, string | null> = {
  ver_prescricao: 'receita',
  sim_reenviar: 'orcamentos',
  fazer_pagamento: null, // topo da própria página do pedido (resumo/status) — não existe uma seção de pagamento dedicada na área do paciente.
  agora_nao: null,
  ganhar_cupom: null
};

/** true para os botões cuja resposta automática precisa de um link de acesso; false para os que só respondem com texto. */
export function whatsappButtonNeedsAccessLink(buttonId: WhatsAppButtonId): boolean {
  return buttonId === 'ver_prescricao' || buttonId === 'sim_reenviar' || buttonId === 'fazer_pagamento';
}

/**
 * Texto da resposta automática enviada assim que o paciente toca um botão.
 * `accessLink` só é necessário para os botões de `whatsappButtonNeedsAccessLink`.
 * `isTestPatient` é revalidado aqui (não só na hora de montar os botões) —
 * nunca envia texto de cupom para quem não está marcado como teste no
 * momento do toque, mesmo que o botão tenha aparecido numa mensagem
 * anterior enviada quando o paciente ainda era de teste.
 */
export function buildWhatsAppButtonFollowUp(buttonId: WhatsAppButtonId, params: { accessLink?: string | null; isTestPatient: boolean }): string {
  switch (buttonId) {
    case 'ver_prescricao':
      return params.accessLink
        ? `Aqui está o seu acesso seguro ao Portal Optótica — sua prescrição está na aba "Minha receita":\n${params.accessLink}\n\nO link é pessoal, expira em 15 minutos e funciona uma única vez.`
        : 'Não conseguimos gerar seu link de acesso agora. Envie "OPTOTICA" para o profissional solicitar um novo convite.';
    case 'sim_reenviar':
      return params.accessLink
        ? `Aqui está o seu acesso seguro ao Portal Optótica — os orçamentos atualizados estão na aba "Escolher lente":\n${params.accessLink}\n\nO link é pessoal, expira em 15 minutos e funciona uma única vez.`
        : 'Não conseguimos gerar seu link de acesso agora. Envie "OPTOTICA" para o profissional solicitar um novo convite.';
    case 'fazer_pagamento':
      return params.accessLink
        ? `Aqui está o seu acesso seguro ao Portal Optótica, com os detalhes do seu pedido:\n${params.accessLink}\n\nO link é pessoal, expira em 15 minutos e funciona uma única vez.`
        : 'Não conseguimos gerar seu link de acesso agora. Envie "OPTOTICA" para o profissional solicitar um novo convite.';
    case 'agora_nao':
      return 'Sem problemas! Se mudar de ideia, é só chamar por aqui.';
    case 'ganhar_cupom':
      return params.isTestPatient
        ? 'Cupom de teste: OPTOTICA-TESTE10 (10% de desconto, uso exclusivo em ambiente de testes — não é válido para compras reais).'
        : 'No momento não há um cupom disponível para você.';
  }
}
