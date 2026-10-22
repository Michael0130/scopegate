import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateScope } from './gate/evaluator.js';
import { createScopedOrder, getOrder, captureOrder } from './paypal/client.js';
import { buildDossier, buildEvidencePayload, provideEvidence } from './paypal/disputes.js';
import { buildDefenseLetterPdf } from './paypal/defense-letter.js';
import { verifyWebhookSignature, PAYPAL_TRANSMISSION_HEADERS } from './paypal/webhooks.js';
import { renderArtifact, artifactHash, recordDispatch, recordAccess, getDeliveryRecord } from './delivery/tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render's proxy: trust X-Forwarded-For so the access log records the
// real client IP (evidence quality for the dispute dossier), not ::1.
app.set('trust proxy', true);

const baseline = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'schemas', 'service.schema.json'), 'utf8'),
);

// In-memory session ledger, keyed by session_id. One negotiation → one frozen decision →
// one PayPal order (PayPal-Request-Id = session_id makes the PayPal side idempotent too).
const sessions = new Map();

// Ring buffer of verified webhook deliveries (newest first) — drives the console feed.
const webhookEvents = [];
const WEBHOOK_EVENT_LIMIT = 20;
// Every raw delivery attempt (verified or not) — debug view for integration.
const webhookAttempts = [];
const WEBHOOK_ATTEMPT_LIMIT = 20;
// Full capture of the most recent delivery for offline signature debugging.
let lastDeliveryCapture = null;

function getSession(id) {
  return sessions.get(id);
}

// PayPal webhooks must hit the raw parser FIRST: the transmission signature is
// computed over the exact request bytes, so this path is mounted before express.json
// (body-parser marks req._body and later parsers skip it).
app.use('/api/webhooks', express.raw({ type: '*/*', limit: '1mb' }));

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Pretty URL for the live console (landing links here).
app.get('/console', (_req, res) => res.redirect('/console.html'));

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
    if (session) {
      session.order_status = capture.status;
      session.payer_email = capture.payer?.email_address ?? session.payer_email ?? null;
      session.capture_id = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? session.capture_id ?? null;
    }
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

// Merchant dispatches the finished artifact to the payer-verified email.
// Requires a created order; the payer email comes from capture when available.
app.post('/api/v1/delivery/:sessionId/dispatch', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  if (!session.order_id) {
    return res.status(409).json({ error: 'order_not_created', message: 'Checkout must succeed before delivery.' });
  }

  const record = recordDispatch(session.session_id, {
    payerEmail: req.body?.payer_email || session.payer_email || 'unverified@scopegate.invalid',
    artifactSha256: artifactHash(session),
    dispatchedAt: new Date().toISOString(),
  });
  res.json({
    session_id: session.session_id,
    payer_email: record.payer_email,
    delivery_dispatched_at: record.delivery_dispatched_at,
    artifact_sha256: record.artifact_sha256,
  });
});

// Recipient picks up the artifact: served byte-identical to the dispatched copy,
// and the pickup is logged (IP, user agent, timestamp) for the dispute dossier.
app.get('/api/v1/delivery/:sessionId/artifact', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const record = getDeliveryRecord(session.session_id);
  if (!record) {
    return res.status(409).json({ error: 'not_dispatched', message: 'Merchant has not dispatched this deliverable yet.' });
  }

  recordAccess(session.session_id, {
    clientIp: req.ip,
    userAgent: req.get('user-agent') || 'unknown',
    accessedAt: new Date().toISOString(),
  });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="scopegate-deliverable-${session.session_id}.txt"`);
  res.send(renderArtifact(session));
});

// One-click Seller Protection §11 evidence package for this session.
app.get('/api/v1/sessions/:sessionId/dossier', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const record = getDeliveryRecord(session.session_id);
  if (!session.order_id || !record || record.accesses.length === 0) {
    return res.status(409).json({ error: 'evidence_incomplete', message: 'Dispatch the deliverable and let the recipient download it first.' });
  }
  res.json(buildDossier(session, record));
});

// The same dossier as a downloadable defense-letter PDF (Seller Protection §11).
app.get('/api/v1/sessions/:sessionId/dossier/pdf', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const record = getDeliveryRecord(session.session_id);
  if (!session.order_id || !record || record.accesses.length === 0) {
    return res.status(409).json({ error: 'evidence_incomplete', message: 'Dispatch the deliverable and let the recipient download it first.' });
  }
  const pdf = buildDefenseLetterPdf(buildDossier(session, record));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="scopegate-defense-letter-${session.session_id}.pdf"`);
  res.send(pdf);
});

// Preview of the exact evidence_info payload that would be POSTed to
// /v1/customer/disputes/{id}/provide-evidence for this session.
app.get('/api/v1/sessions/:sessionId/evidence-payload', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const record = getDeliveryRecord(session.session_id);
  if (!record || record.accesses.length === 0) {
    return res.status(409).json({ error: 'evidence_incomplete', message: 'Dispatch + download must happen before evidence exists.' });
  }
  res.json({
    provide_evidence_endpoint: 'POST /v1/customer/disputes/{dispute_id}/provide-evidence',
    evidence_type: 'PROOF_OF_FULFILLMENT',
    multipart_parts: ['evidence_info (application/json)', 'notes', 'files: defense letter PDF'],
    evidence_info: buildEvidencePayload(buildDossier(session, record), session),
  });
});

// Fire the real Disputes API call against a live dispute id (phase 2 route).
app.post('/api/v1/disputes/:disputeId/provide-evidence', async (req, res) => {
  const session = getSession(req.body?.session_id);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const record = getDeliveryRecord(session.session_id);
  if (!record || record.accesses.length === 0) {
    return res.status(409).json({ error: 'evidence_incomplete', message: 'Dispatch + download must happen before evidence exists.' });
  }
  try {
    const dossier = buildDossier(session, record);
    const pdf = buildDefenseLetterPdf(dossier);
    const result = await provideEvidence({ disputeId: req.params.disputeId, dossier, session, pdfBuffer: pdf });
    session.dispute = { ...(session.dispute ?? {}), evidence_submitted_at: new Date().toISOString() };
    res.json(result);
  } catch (err) {
    console.error('[provide-evidence]', err.message);
    res.status(502).json({ error: 'paypal_failure', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// PayPal webhook ingestion (Master Spec §4.1.4). Raw body is mandatory: the
// transmission signature is computed over the exact bytes PayPal sent.
// ---------------------------------------------------------------------------

/** Match an event resource back to its session via contract hash, order or capture id. */
function matchSession(resource = {}) {
  const ids = new Set();
  const tx = resource.disputed_transactions?.[0] ?? {};
  for (const v of [resource.custom_id, resource.id, tx.seller_transaction_id, tx.related_transaction_id]) {
    if (typeof v === 'string' && v) ids.add(v);
  }
  return [...sessions.values()].find(
    (s) => ids.has(s.decision.contract_hash) || (s.order_id && ids.has(s.order_id)) || (s.capture_id && ids.has(s.capture_id)),
  );
}

function applyWebhookEvent(event) {
  const session = matchSession(event.resource ?? {});
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && session) {
    session.order_status = 'COMPLETED';
    session.capture_id = session.capture_id ?? event.resource?.id ?? null;
  }
  if (event.event_type === 'CUSTOMER.DISPUTE.CREATED' && session) {
    session.dispute = {
      dispute_id: event.resource?.dispute_id ?? event.resource?.id ?? null,
      reason: event.resource?.reason ?? null,
      status: event.resource?.status ?? 'OPEN',
      amount: event.resource?.dispute_amount?.value ?? null,
      created_at: event.create_time,
    };
  }
  return session?.session_id ?? null;
}

app.post('/api/webhooks/paypal', async (req, res) => {
  const headers = {};
  for (const h of PAYPAL_TRANSMISSION_HEADERS) {
    const v = req.get(h);
    if (v) headers[h] = v;
  }
  if (Object.keys(headers).length < PAYPAL_TRANSMISSION_HEADERS.length) {
    // Not a genuine PayPal delivery — no point asking the verifier about it.
    webhookAttempts.unshift({ at: new Date().toISOString(), headers: Object.keys(headers), verdict: 'dropped: missing transmission headers' });
    webhookAttempts.length = Math.min(webhookAttempts.length, WEBHOOK_ATTEMPT_LIMIT);
    return res.status(401).json({ error: 'invalid_signature', message: 'missing PayPal transmission headers' });
  }
  try {
    const verdict = await verifyWebhookSignature(headers, req.body);
    if (verdict.verification_status !== 'SUCCESS') {
      console.warn('[webhook] signature verification FAILED — dropping delivery');
      webhookAttempts.unshift({ at: new Date().toISOString(), headers: Object.keys(headers), verdict: 'rejected: ' + (verdict.verification_status ?? 'unknown') });
      webhookAttempts.length = Math.min(webhookAttempts.length, WEBHOOK_ATTEMPT_LIMIT);
      lastDeliveryCapture = { at: new Date().toISOString(), paypal_headers: headers, raw_body: req.body.toString('utf8') };
      return res.status(401).json({ error: 'invalid_signature' });
    }
    const event = JSON.parse(req.body.toString('utf8'));
    webhookAttempts.unshift({ at: new Date().toISOString(), headers: Object.keys(headers), verdict: 'verified', event_id: event.id, event_type: event.event_type });
    webhookAttempts.length = Math.min(webhookAttempts.length, WEBHOOK_ATTEMPT_LIMIT);
    const matchedSession = applyWebhookEvent(event);
    webhookEvents.unshift({
      id: event.id,
      event_type: event.event_type,
      create_time: event.create_time,
      verified: true,
      matched_session: matchedSession,
      resource_summary: {
        id: event.resource?.id ?? null,
        amount: event.resource?.amount?.value ?? event.resource?.dispute_amount?.value ?? null,
        reason: event.resource?.reason ?? null,
      },
      received_at: new Date().toISOString(),
    });
    webhookEvents.length = Math.min(webhookEvents.length, WEBHOOK_EVENT_LIMIT);
    console.log(`[webhook] VERIFIED ${event.event_type} (${event.id}) → session ${matchedSession ?? 'no match'}`);
    res.status(200).send();
  } catch (err) {
    console.error('[webhook]', err.message);
    // 500 makes PayPal retry the delivery; signature-verifier outages should not eat events.
    res.status(500).json({ error: 'verification_unavailable' });
  }
});

app.get('/api/v1/webhook-events', (req, res) => {
  res.json({
    webhook_url: '/api/webhooks/paypal',
    events: webhookEvents,
    ...(req.query.raw === '1' ? { raw_attempts: webhookAttempts } : {}),
    ...(req.query.capture === '1' ? { last_delivery_capture: lastDeliveryCapture } : {}),
  });
});

app.listen(PORT, () => {
  console.log(`[scopegate] listening on :${PORT} (gate_mode=${process.env.LLM_API_KEY ? 'llm' : 'degraded'})`);
});
