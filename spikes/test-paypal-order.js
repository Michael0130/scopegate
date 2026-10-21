// P0 spike (Master Spec §5): prove the PayPal sandbox plumbing before building on it.
// Verifies: OAuth2 client-credentials, Orders v2 creation with custom_id = contract SHA-256,
// custom_id echo in the response, NO_SHIPPING (intangible service), and PayPal-Request-Id
// idempotency (same header + body twice must resolve to the same order).
//
// Usage: PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npm run spike  (sandbox credentials only)

import crypto from 'node:crypto';

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function createOrder(token, requestId, contractHash) {
  const res = await fetch(`${BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: 'PU_SCOPE_GATE_001',
        description: 'ScopeGate Protected Service: Bespoke Next.js Landing Page',
        custom_id: contractHash,
        amount: { currency_code: 'USD', value: '500.00' },
      }],
      application_context: {
        brand_name: 'ScopeGate Merchant Shield',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    }),
  });
  const order = await res.json();
  if (!res.ok) throw new Error(`Create Order failed: ${JSON.stringify(order)}`);
  return order;
}

function report(label, pass, detail) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

(async () => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('[Spike] Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET. Copy .env.example to .env first.');
    process.exit(1);
  }

  try {
    const token = await getAccessToken();
    console.log('[1] OAuth2 access token acquired.');

    const mockScope = {
      service_id: 'srv_nextjs_landing',
      agreed_deliverables: ['3 responsive sections', 'Tailwind CSS dark-mode'],
      explicit_exclusions: ['Native iOS/Android app', 'Backend DB'],
      max_revisions: 2,
      turnaround_hours: 72,
    };
    // 64-char hex SHA-256 hash (fits well within PayPal custom_id 127-char limit)
    const contractHash = crypto.createHash('sha256').update(JSON.stringify(mockScope)).digest('hex');
    const requestId = `req_scope_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    console.log(`[Contract Hash (64 chars)]: ${contractHash}`);
    console.log(`[PayPal-Request-Id]: ${requestId}`);

    console.log('[2] Creating order (first send)...');
    const first = await createOrder(token, requestId, contractHash);
    console.log(`    Order ID: ${first.id}`);
    console.log(`    Order Status: ${first.status}`);
    console.log(`    Approval Link: ${first.links.find(l => l.rel === 'approve')?.href}`);

    const echoed = first.purchase_units?.[0]?.custom_id;
    report('custom_id echoed intact in create response', echoed === contractHash, `echoed=${echoed}`);
    report('shipping_preference honored (NO_SHIPPING / no shipping object)', !first.purchase_units?.[0]?.shipping);

    console.log('[3] Re-sending identical request with the same PayPal-Request-Id...');
    const second = await createOrder(token, requestId, contractHash);
    console.log(`    Order ID: ${second.id}`);
    report('idempotent replay returns the SAME order id', first.id === second.id);

    console.log('[Spike] Done.');
  } catch (err) {
    console.error('[Spike Error]:', err.message);
    process.exitCode = 1;
  }
})();
