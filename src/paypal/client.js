// PayPal sandbox client (Master Spec §4): OAuth2, Orders v2 with the contract-hash anchor,
// and Capture. Three non-negotiable request anchors for every order created here:
//   - purchase_units[0].custom_id       = 64-char SHA-256 contract hash
//   - application_context.shipping_preference = 'NO_SHIPPING' (intangible service)
//   - Headers['PayPal-Request-Id']      = session_id (agent-retry idempotency)
// The validated request recipe lives in spikes/test-paypal-order.js; this wrapper lands in D2.

const BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

export async function getAccessToken() {
  throw new Error('getAccessToken: lands in D2 — see spikes/test-paypal-order.js for the validated recipe');
}

export async function createScopedOrder(token, { contractHash, sessionId, price, currency = 'USD' }) {
  throw new Error('createScopedOrder: lands in D2');
}

export async function captureOrder(token, orderId) {
  throw new Error('captureOrder: lands in D2');
}
