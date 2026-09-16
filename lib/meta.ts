import crypto from 'node:crypto';
import { serverEnv } from '@/lib/env';

export function validMetaSignature(rawBody: string, signature: string | null) {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', serverEnv.metaAppSecret()).update(rawBody).digest('hex')}`;
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function sendWhatsAppText(to: string, body: string) {
  const endpoint = `https://graph.facebook.com/${serverEnv.metaGraphVersion()}/${serverEnv.metaPhoneNumberId()}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serverEnv.metaAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } })
  });
  if (!response.ok) throw new Error(`Meta API respondeu ${response.status}`);
}

export function firstIncomingMessage(payload: unknown): { phone: string; messageId: string; text: string } | null {
  const data = payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ from?: string; id?: string; text?: { body?: string } }> } }> }> };
  const message = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const phone = message?.from?.replace(/\D/g, '');
  return phone && message?.id ? { phone, messageId: message.id, text: message.text?.body?.trim() || '' } : null;
}

// A partir daqui: funções aditivas para o fluxo de mensagens de WhatsApp por
// estágio do atendimento (16/09/2026, ver lib/order-whatsapp-stage.ts e
// app/api/professional/orders/[orderId]/whatsapp-stage/route.ts). Nada
// acima desta linha foi alterado.

/**
 * Envia uma mensagem interativa com até 3 botões de RESPOSTA rápida
 * ("reply" — o toque só devolve um id/título por webhook, nunca abre um
 * link: a Cloud API do WhatsApp não permite combinar botões de resposta com
 * um botão que abre URL na mesma mensagem). Retorna o wamid da mensagem
 * enviada — usado como `whatsapp_message_id` em `order_whatsapp_messages`,
 * para que o webhook consiga achar o pedido/estágio de origem quando o
 * paciente tocar um botão (via `context.id` da resposta).
 */
export async function sendWhatsAppButtons(to: string, bodyText: string, buttons: { id: string; title: string }[]): Promise<string> {
  const endpoint = `https://graph.facebook.com/${serverEnv.metaGraphVersion()}/${serverEnv.metaPhoneNumberId()}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serverEnv.metaAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons: buttons.map((button) => ({ type: 'reply', reply: { id: button.id, title: button.title.slice(0, 20) } })) }
      }
    })
  });
  const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: string }> } | null;
  if (!response.ok) throw new Error(`Meta API respondeu ${response.status}`);
  const messageId = payload?.messages?.[0]?.id;
  if (!messageId) throw new Error('Meta API não retornou o id da mensagem enviada');
  return messageId;
}

/**
 * Igual a `sendWhatsAppText`, mas devolve o wamid — usado na resposta
 * automática de texto puro que segue um toque em botão (ver webhook), para
 * registrar essa resposta também em `order_whatsapp_messages`.
 */
export async function sendWhatsAppTextAndGetId(to: string, body: string): Promise<string> {
  const endpoint = `https://graph.facebook.com/${serverEnv.metaGraphVersion()}/${serverEnv.metaPhoneNumberId()}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serverEnv.metaAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } })
  });
  const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: string }> } | null;
  if (!response.ok) throw new Error(`Meta API respondeu ${response.status}`);
  return payload?.messages?.[0]?.id || '';
}

/**
 * Reconhece uma resposta a botão de RESPOSTA RÁPIDA (interactive/button_reply)
 * — diferente de `firstIncomingMessage`, que só lê mensagens de texto puro
 * (usado pelo fluxo "OPTOTICA <código>" já existente, inalterado). Devolve
 * também `contextMessageId` (o wamid da mensagem que tinha os botões, vindo
 * de `context.id` no payload da Meta) — é assim que o webhook descobre a
 * qual pedido/estágio aquele toque pertence, sem guardar nenhum estado novo
 * em memória.
 */
export function firstIncomingButtonReply(payload: unknown): { phone: string; messageId: string; contextMessageId: string; buttonId: string; buttonTitle: string } | null {
  const data = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from?: string;
            id?: string;
            type?: string;
            context?: { id?: string };
            interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
          }>;
        };
      }>;
    }>;
  };
  const message = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'interactive' || message.interactive?.type !== 'button_reply') return null;
  const phone = message.from?.replace(/\D/g, '');
  const buttonId = message.interactive.button_reply?.id;
  const contextMessageId = message.context?.id;
  if (!phone || !message.id || !buttonId || !contextMessageId) return null;
  return { phone, messageId: message.id, contextMessageId, buttonId, buttonTitle: message.interactive.button_reply?.title || '' };
}
