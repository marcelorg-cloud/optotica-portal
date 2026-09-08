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
