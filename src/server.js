import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateScope } from './gate/evaluator.js';
import { createScopedOrder, getOrder, captureOrder } from './paypal/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const baseline = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'schemas', 'service.schema.json'), 'utf8'),
);

// In-memory session ledger, keyed by session_id. One negotiation → one frozen decision →
// one PayPal order (PayPal-Request-Id = session_id makes the PayPal side idempotent too).
const sessions = new Map();

function getSession(id) {
  return sessions.get(id);
}

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/v1/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'scopegate',
    gate_mode: process.env.LLM_API_KEY ? 'llm' : 'degraded',
    time: new Date().toISOString(),
  });
});

// Natural-language buyer request -> ACCEPT | COUNTER | REJECT (schemas/decision.schema.json).
app.post('/api/v1/scope/negotiate', async (req, res) => {
  const { buyer_message: buyerMessage } = req.body ?? {};
  if (!buyerMessage || typeof buyerMessage !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'buyer_message (string) is required' });
  }

  const sessionId = typeof req.body.session_id === 'string' && req.body.session_id
    ? req.body.session_id
    : `req_scope_${crypto.randomBytes(6).toString('hex')}`;

  try {
    const decision = await evaluateScope({ buyer_message: buyerMessage }, baseline);
    decision.session_id = sessionId;

    const session = {
      session_id: sessionId,
      decision,
      order_id: null,
      order_status: 'NONE',
      created_at: decision.timestamp,
    };
    sessions.set(sessionId, session);
    res.json(decision);
  } catch (err) {
    console.error('[negotiate]', err.message);
    res.status(502).json({ error: 'gate_failure', message: err.message, session_id: sessionId });
  }
});

// Buyer accepts the frozen quote -> create the PayPal order anchored on the contract hash.
// Repeated calls with the same session_id replay the same PayPal order (Case 6 idempotency).
app.post('/api/v1/checkout', async (req, res) => {
  const sessionId = req.body?.session_id;
  const session = sessionId && getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found', message: 'Negotiate first.' });
  if (session.decision.decision === 'REJECT') {
    return res.status(409).json({ error: 'rejected', message: 'This session was rejected by the gate; nothing to check out.' });
  }

  try {
    const order = await createScopedOrder({
      contractHash: session.decision.contract_hash,
      paypalRequestId: sessionId,
      amount: session.decision.quoted_price,
      currency: baseline.currency,
      description: baseline.title,
    });

    const replay = session.order_id !== null;
    if (replay && order.id !== session.order_id) {
      // Should never happen: same PayPal-Request-Id must resolve to the same order.
      console.error(`[checkout] IDEMPOTENCY VIOLATION: ${session.order_id} vs ${order.id}`);
    }
    session.order_id = order.id;
    session.order_status = order.status;

    res.json({
      session_id: sessionId,
      order_id: order.id,
      status: order.status,
      replayed: replay,
      approve_url: order.links?.find((l) => l.rel === 'approve')?.href ?? null,
      contract_hash: session.decision.contract_hash,
    });
  } catch (err) {
    console.error('[checkout]', err.message);
    res.status(502).json({ error: 'paypal_failure', message: err.message });
  }
});

// After the buyer approves on sandbox.paypal.com, the frontend calls this to capture funds.
app.post('/api/v1/orders/:id/capture', async (req, res) => {
  try {
    const capture = await captureOrder(req.params.id);
    const session = [...sessions.values()].find((s) => s.order_id === req.params.id);
    if (session) session.order_status = capture.status;
    res.json({
      order_id: req.params.id,
      status: capture.status,
      payer_email: capture.payer?.email_address ?? null,
      custom_id_anchor: capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ?? null,
    });
  } catch (err) {
    console.error('[capture]', err.message);
    res.status(502).json({ error: 'paypal_failure', message: err.message });
  }
});

app.get('/api/v1/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  res.json(session);
});

app.listen(PORT, () => {
  console.log(`[scopegate] listening on :${PORT} (gate_mode=${process.env.LLM_API_KEY ? 'llm' : 'degraded'})`);
});
