// PayPal sandbox client (Master Spec §4): OAuth2, Orders v2 with the contract-hash anchor,
// and Capture. Every order created here carries the three non-negotiable anchors:
//   - purchase_units[0].custom_id       = `${contractHash}:m${n}` (v0.4 milestone anchor,
//     69 chars — the bare 64-char hash stays the prefix so every milestone order provably
//     belongs to the same contract)
//   - application_context.shipping_preference = 'NO_SHIPPING' (intangible service)
//   - Headers['PayPal-Request-Id']      = `${session_id}:${milestone_id}` (per-milestone
//     idempotency — agent retries can never double-charge one stage)
// Recipe validated in spikes/test-paypal-order.js: the create response does NOT echo
// custom_id — verify the anchor via getOrder() (the query path the dispute flow uses).
//
// v0.5 multi-seller: every call takes an optional `{ clientId, clientSecret }` credentials
// object, so each seller's orders settle into THEIR OWN PayPal account. Omitting credentials
// falls back to the legacy PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET pair (the default seller).
// Tokens are cached per client id — three sellers, three independent token lifetimes.

const BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

const tokenCaches = new Map(); // clientId -> { value, expiresAt }

export function resolveCredentials(credentials) {
  const clientId = credentials?.clientId ?? process.env.PAYPAL_CLIENT_ID;
  const clientSecret = credentials?.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials missing: set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (or the seller-specific pair)');
  }
  return { clientId, clientSecret };
}

export async function getAccessToken(credentials) {
  const { clientId, clientSecret } = resolveCredentials(credentials);
  const cache = tokenCaches.get(clientId);
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`PayPal auth failed: ${JSON.stringify(data)}`);
      tokenCaches.set(clientId, {
        value: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000,
      });
      return data.access_token;
    } catch (err) {
      lastErr = err;
      tokenCaches.delete(clientId);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Create (or idempotently re-fetch) a PayPal order for a frozen gatekeeper decision.
 * paypalRequestId MUST be stable per session+milestone — retries with the same value return
 * the same order instead of double-charging. `credentials` routes the order to a specific
 * seller's PayPal account (config/sellers.json → SELLER_*_CLIENT_ID/SECRET).
 */
export async function createScopedOrder({ contractHash, paypalRequestId, amount, currency = 'USD', description, deliverablesSummary = '', credentials }) {
  const { clientId } = resolveCredentials(credentials);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await getAccessToken(credentials);
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
            items: [{
              name: String(description).split('—')[1]?.trim() || String(description).slice(0, 60),
              description: deliverablesSummary
                ? `Agreed Delivery: ${deliverablesSummary} | Contract: ${contractHash}`.slice(0, 127)
                : `SHA-256 Contract Anchor: ${contractHash}`.slice(0, 127),
              unit_amount: { currency_code: currency, value: amount.toFixed(2) },
              quantity: '1',
              category: 'DIGITAL_GOODS',
            }],
            amount: {
              currency_code: currency,
              value: amount.toFixed(2),
              breakdown: {
                item_total: { currency_code: currency, value: amount.toFixed(2) },
              },
            },
          }],
          application_context: {
            brand_name: 'ScopeGate Merchant Shield',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: `${process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`}/api/v1/paypal/return`,
            cancel_url: `${process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`}/api/v1/paypal/cancel`,
          },
        }),
        signal: AbortSignal.timeout(18000),
      });
      const order = await res.json();
      if (!res.ok) throw new Error(`Create order failed: ${JSON.stringify(order)}`);
      return order;
    } catch (err) {
      lastErr = err;
      tokenCaches.delete(clientId);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function getOrder(orderId, credentials) {
  const { clientId } = resolveCredentials(credentials);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await getAccessToken(credentials);
      const res = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      const order = await res.json();
      if (!res.ok) throw new Error(`Get order failed: ${JSON.stringify(order)}`);
      return order;
    } catch (err) {
      lastErr = err;
      tokenCaches.delete(clientId);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function captureOrder(orderId, credentials) {
  const { clientId } = resolveCredentials(credentials);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await getAccessToken(credentials);
      const res = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `capture_${orderId}`,
        },
        signal: AbortSignal.timeout(18000),
      });
      const capture = await res.json();
      if (!res.ok) {
        // If already captured, degrade gracefully by retrieving the order
        if (capture.details?.some((d) => d.issue === 'ORDER_ALREADY_CAPTURED')) {
          const ord = await getOrder(orderId, credentials);
          return ord;
        }
        throw new Error(`Capture failed: ${JSON.stringify(capture)}`);
      }
      return capture;
    } catch (err) {
      lastErr = err;
      tokenCaches.delete(clientId);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}
