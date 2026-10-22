#!/usr/bin/env node
// Webhook lifecycle for ScopeGate (Master Spec §4.1.4):
//   node scripts/register-webhook.js              → idempotent register (reuse by URL), print id
//   node scripts/register-webhook.js simulate CUSTOMER.DISPUTE.CREATED
//                                                 → fire a signed sandbox delivery at the webhook
//
// Empirical sandbox facts (2026-10-22):
//   - simulate-event must be called with `url`; passing `webhook_id` fails with
//     "Not a valid Resource Type".
//   - CHECKOUT.ORDER.APPROVED is NOT simulatable (same error); PAYMENT.CAPTURE.*
//     and CUSTOMER.DISPUTE.* are (202 Accepted, real signed delivery).
//   - The receiver must capture the RAW body for verify-webhook-signature.
import { listWebhooks, registerWebhook, simulateEvent } from '../src/paypal/webhooks.js';

const URL = process.env.WEBHOOK_URL || 'https://scopegate.onrender.com/api/webhooks/paypal';
const EVENT_TYPES = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'CUSTOMER.DISPUTE.CREATED'];

const [, , cmd, arg] = process.argv;

try {
  if (cmd === 'simulate') {
    const result = await simulateEvent(arg || 'CUSTOMER.DISPUTE.CREATED');
    console.log('simulate-event accepted:', JSON.stringify({ id: result.id, event_type: result.event_type }, null, 2));
  } else {
    const existing = (await listWebhooks()).find((w) => w.url === URL);
    const webhook = existing ?? (await registerWebhook(URL, EVENT_TYPES));
    console.log(JSON.stringify({
      webhook_id: webhook.id,
      url: webhook.url,
      event_types: webhook.event_types.map((e) => e.name),
      reused: Boolean(existing),
      note: 'store webhook_id in config/webhook.json (or PAYPAL_WEBHOOK_ID) so the server can verify signatures',
    }, null, 2));
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
