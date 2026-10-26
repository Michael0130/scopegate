// PayPal Webhooks (Master Spec §4.1.4): signature verification + event simulation.
// The receiver must NEVER trust the body without verifying PayPal's transmission
// signature against the registered webhook id — that is the whole point of
// `POST /v1/notifications/verify-webhook-signature`.
//
// Sandbox facts validated 2026-10-22 (see scripts/register-webhook.js):
//   - POST /v1/notifications/webhooks        registers {url, event_types[]} → id
//   - POST /v1/notifications/simulate-event  202 Accepted; must pass `url`
//     (passing `webhook_id` instead fails with "Not a valid Resource Type"),
//     and CHECKOUT.ORDER.APPROVED is not simulatable — DISPUTE/CAPTURE are.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAccessToken } from './client.js';

const BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

let webhookConfig = null;

/** Registered sandbox webhook (config/webhook.json, non-secret) — env var wins. */
export function getWebhookConfig() {
  if (!webhookConfig) {
    try {
      const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'webhook.json');
      webhookConfig = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      webhookConfig = {};
    }
  }
  return { ...webhookConfig, webhook_id: process.env.PAYPAL_WEBHOOK_ID || webhookConfig?.webhook_id };
}

/**
 * Verify a delivery's PAYPAL-* headers against the raw request body.
 * `options.webhookId` selects which registration to verify against — with multiple
 * sellers each app has its own webhook id, so the receiver tries each until one
 * returns SUCCESS. `options.credentials` verifies with that seller's own token.
 * Returns PayPal's verdict, e.g. { verification_status: 'SUCCESS' }.
 */
export async function verifyWebhookSignature(headers, rawBody, options = {}) {
  const webhookId = options.webhookId ?? getWebhookConfig().webhook_id;
  if (!webhookId) throw new Error('No webhook id configured (config/webhook.json or PAYPAL_WEBHOOK_ID)');
  const token = await getAccessToken(options.credentials);

  const res = await fetch(`${BASE_URL}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody.toString('utf8')),
    }),
  });
  const verdict = await res.json();
  if (!res.ok) throw new Error(`Signature verification call failed: ${JSON.stringify(verdict)}`);
  return verdict;
}

/** Delivery headers a receiver must forward for verification (case-insensitive). */
export const PAYPAL_TRANSMISSION_HEADERS = [
  'paypal-auth-algo',
  'paypal-cert-url',
  'paypal-transmission-id',
  'paypal-transmission-sig',
  'paypal-transmission-time',
];

export async function listWebhooks() {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v1/notifications/webhooks`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`List webhooks failed: ${JSON.stringify(data)}`);
  return data.webhooks ?? [];
}

export async function registerWebhook(url, eventTypes) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v1/notifications/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, event_types: eventTypes.map((name) => ({ name })) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Register webhook failed: ${JSON.stringify(data)}`);
  return data;
}

/** Fire a signed sandbox delivery at the registered webhook URL. */
export async function simulateEvent(eventType) {
  const token = await getAccessToken();
  const { url } = getWebhookConfig();
  const res = await fetch(`${BASE_URL}/v1/notifications/simulate-event`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, event_type: eventType }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Simulate event failed: ${JSON.stringify(data)}`);
  return data;
}
