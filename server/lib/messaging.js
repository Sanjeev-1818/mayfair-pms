// WhatsApp Cloud API (Meta, direct). Replies inside the 24-hour window that the player opened are free.
import crypto from 'node:crypto';
import { config, whatsappEnabled } from '../config.js';

export async function sendWhatsAppText(toE164, body) {
  if (!whatsappEnabled()) {
    console.log(`[whatsapp:test] to ${toE164}: ${body}`);
    return { test: true };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toE164.replace(/^\+/, ''),
      type: 'text',
      text: { body, preview_url: true },
    }),
  });
  if (!res.ok) console.error('WhatsApp send failed', res.status, await res.text());
  return { ok: res.ok };
}

// Backup code delivery (SMS / WhatsApp template). Plug a provider in here later; test mode logs it.
export async function sendCode(toE164, code) {
  console.log(`[code:test] sign-in code for ${toE164}: ${code}`);
  return { test: true };
}

export function verifyWebhookSignature(rawBody, header) {
  if (!config.whatsapp.appSecret) return !config.isProd;
  const expected = 'sha256=' + crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(header || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function whatsappLink(text) {
  return `https://wa.me/${config.whatsapp.businessNumber}?text=${encodeURIComponent(text)}`;
}
