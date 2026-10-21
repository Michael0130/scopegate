// PayPal sandbox client (Master Spec §4): OAuth2, Orders v2 with the contract-hash anchor,
// and Capture. Every order created here carries the three non-negotiable anchors:
//   - purchase_units[0].custom_id       = 64-char SHA-256 contract hash
//   - application_context.shipping_preference = 'NO_SHIPPING' (intangible service)
//   - Headers['PayPal-Request-Id']      = session_id (agent-retry idempotency)
// Recipe validated in spikes/test-paypal-order.js: the create response does NOT echo
// custom_id — verify the anchor via getOrder() (the query path the dispute flow uses).

const BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

let tokenCache = { value: null, expiresAt: 0 };

export async function getAccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PayPal credentials missing: set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET');

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed: ${JSON.stringify(data)}`);
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000,
  };
  return tokenCache.value;
}

/**
 * Create (or idempotently re-fetch) a PayPal order for a frozen gatekeeper decision.
 * paypalRequestId MUST be stable per buyer session — retries with the same value return
 * the same order instead of double-charging.
 */
export async function createScopedOrder({ contractHash, paypalRequestId, amount, currency = 'USD', description }) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': paypalRequestId,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: 'PU_SCOPE_GATE_001',
        description: String(description).slice(0, 127),
        custom_id: contractHash,
        amount: { currency_code: currency, value: amount.toFixed(2) },
      }],
      application_context: {
        brand_name: 'ScopeGate Merchant Shield',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    }),
  });
  const order = await res.json();
  if (!res.ok) throw new Error(`Create order failed: ${JSON.stringify(order)}`);
  return order;
}

export async function getOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const order = await res.json();
  if (!res.ok) throw new Error(`Get order failed: ${JSON.stringify(order)}`);
  return order;
}

export async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `capture_${orderId}`,
    },
  });
  const capture = await res.json();
  if (!res.ok) throw new Error(`Capture failed: ${JSON.stringify(capture)}`);
  return capture;
}
