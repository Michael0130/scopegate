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
// N milestone PayPal orders (v0.4: deposit → stages → final). Each milestone carries
// PayPal-Request-Id = `${session_id}:${milestone_id}`, so retries stay idempotent per stage.
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

// ---- Milestone helpers (v0.4): one session, N milestone payments ----

function paymentFor(session, milestoneId) {
  return session.payments?.find((p) => p.milestone_id === milestoneId) ?? null;
}

/** A milestone is accepted once its artifact has been dispatched AND downloaded. */
function isAccepted(session, milestoneId) {
  const record = getDeliveryRecord(session.session_id, milestoneId);
  return !!(record && record.accesses.length > 0);
}

/** m1 is always payable (contract hash = signature); milestone N needs N-1 paid + accepted. */
function milestoneUnlocked(session, milestoneId) {
  const idx = session.payments?.findIndex((p) => p.milestone_id === milestoneId) ?? -1;
  if (idx < 0) return false;
  if (idx === 0) return true;
  const prev = session.payments[idx - 1];
  return prev.order_status === 'COMPLETED' && isAccepted(session, prev.milestone_id);
}

/** Pick the milestone a dossier should describe: the explicit one, or the latest accepted. */
function resolveEvidenceMilestone(session, requested) {
  if (requested) return paymentFor(session, requested) ? requested : null;
  for (let i = (session.payments?.length ?? 0) - 1; i >= 0; i--) {
    const mid = session.payments[i].milestone_id;
    if (isAccepted(session, mid)) return mid;
  }
  return null;
}

// PayPal webhooks must hit the raw parser FIRST: the transmission signature is
// computed over the exact request bytes, so this path is mounted before express.json
// (body-parser marks req._body and later parsers skip it).
app.use('/api/webhooks', express.raw({ type: '*/*', limit: '1mb' }));

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Pretty URL for the live console (landing links here).
app.get('/console', (_req, res) => res.redirect('/console.html'));

// Machine-readable API contract (console topbar link + APIMatic SDK import URL).
app.get('/openapi.json', (_req, res) => res.sendFile(path.join(__dirname, '..', 'openapi.json')));

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
      // One payment slot per contract milestone; delivery state lives in the tracker.
      payments: (decision.payment_plan ?? []).map((m) => ({
        milestone_id: m.milestone_id,
        label: m.label,
        amount: m.amount,
        order_id: null,
        order_status: 'NONE',
        approve_url: null,
        capture_id: null,
        payer_email: null,
        captured_at: null,
      })),
      dispute: null,
      created_at: decision.timestamp,
    };
    sessions.set(sessionId, session);
    res.json(decision);
  } catch (err) {
    console.error('[negotiate]', err.message);
    res.status(502).json({ error: 'gate_failure', message: err.message, session_id: sessionId });
  }
});

// Buyer accepts the frozen quote -> create a PayPal order for ONE contract milestone,
// anchored on `${contractHash}:mN`. Milestones unlock in order: m1 any time, mN only after
// m(N-1) is captured AND its artifact accepted (downloaded). Repeated calls with the same
// session_id + milestone_id replay the same PayPal order (Case 6 idempotency).
app.post('/api/v1/checkout', async (req, res) => {
  const sessionId = req.body?.session_id;
  const milestoneId = req.body?.milestone_id ?? 'm1';
  const session = sessionId && getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found', message: 'Negotiate first.' });
  if (session.decision.decision === 'REJECT') {
    return res.status(409).json({ error: 'rejected', message: 'This session was rejected by the gate; nothing to check out.' });
  }
  const payment = paymentFor(session, milestoneId);
  if (!payment) {
    return res.status(400).json({ error: 'unknown_milestone', message: `No milestone '${milestoneId}' in the frozen payment plan.` });
  }
  if (!payment.order_id && !milestoneUnlocked(session, milestoneId)) {
    return res.status(409).json({
      error: 'milestone_locked',
      message: `Milestone '${milestoneId}' unlocks after the previous milestone is paid and its deliverable is downloaded.`,
    });
  }

  try {
    const order = await createScopedOrder({
      contractHash: `${session.decision.contract_hash}:${milestoneId}`,
      paypalRequestId: `${sessionId}:${milestoneId}`,
      amount: payment.amount,
      currency: baseline.currency,
      description: `${baseline.title} — ${payment.label}`,
    });

    const replay = payment.order_id !== null;
    if (replay && order.id !== payment.order_id) {
      // Should never happen: same PayPal-Request-Id must resolve to the same order.
      console.error(`[checkout] IDEMPOTENCY VIOLATION: ${payment.order_id} vs ${order.id}`);
    }
    payment.order_id = order.id;
    payment.order_status = order.status;
    payment.approve_url = order.links?.find((l) => l.rel === 'approve')?.href ?? null;

    res.json({
      session_id: sessionId,
      milestone_id: milestoneId,
      amount: payment.amount,
      order_id: order.id,
      status: order.status,
      replayed: replay,
      approve_url: payment.approve_url,
      contract_hash: session.decision.contract_hash,
      custom_id: `${session.decision.contract_hash}:${milestoneId}`,
    });
  } catch (err) {
    console.error('[checkout]', err.message);
    res.status(502).json({ error: 'paypal_failure', message: err.message });
  }
});

// After the buyer approves on sandbox.paypal.com, the frontend calls this to capture funds
// for that one milestone order.
app.post('/api/v1/orders/:id/capture', async (req, res) => {
  try {
    const capture = await captureOrder(req.params.id);
    let hit = null;
    for (const session of sessions.values()) {
      const payment = session.payments?.find((p) => p.order_id === req.params.id);
      if (payment) { hit = { session, payment }; break; }
    }
    if (hit) {
      const { session, payment } = hit;
      payment.order_status = capture.status;
      payment.payer_email = capture.payer?.email_address ?? payment.payer_email ?? null;
      payment.capture_id = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? payment.capture_id ?? null;
      payment.captured_at = new Date().toISOString();
      session.payer_email = session.payer_email ?? payment.payer_email;
    }
    res.json({
      order_id: req.params.id,
      milestone_id: hit?.payment.milestone_id ?? null,
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

// Merchant dispatches the milestone artifact to the payer-verified email.
// Gate: that milestone's order exists (the console ladder only offers dispatch after
// capture — and a dossier built from an uncaptured stage self-documents the missing
// capture in its payment_ledger rows). The HARD gate is the next payment: milestone N+1
// cannot be checked out until N is captured AND its deliverable is downloaded.
app.post('/api/v1/delivery/:sessionId/dispatch', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const milestoneId = req.body?.milestone_id ?? 'm1';
  const payment = paymentFor(session, milestoneId);
  if (!payment) {
    return res.status(400).json({ error: 'unknown_milestone', message: `No milestone '${milestoneId}' in the frozen payment plan.` });
  }
  if (!payment.order_id) {
    return res.status(409).json({ error: 'order_not_created', message: `Checkout milestone '${milestoneId}' before dispatching its deliverable.` });
  }

  const record = recordDispatch(session.session_id, milestoneId, {
    payerEmail: payment.payer_email || req.body?.payer_email || 'unverified@scopegate.invalid',
    artifactSha256: artifactHash(session, milestoneId),
    dispatchedAt: new Date().toISOString(),
  });
  res.json({
    session_id: session.session_id,
    milestone_id: milestoneId,
    payer_email: record.payer_email,
    delivery_dispatched_at: record.delivery_dispatched_at,
    artifact_sha256: record.artifact_sha256,
  });
});

// Recipient picks up the milestone artifact: served byte-identical to the dispatched copy,
// and the pickup is logged (IP, user agent, timestamp) for the dispute dossier.
// `?milestone=mN` selects the stage; absent query defaults to m1 (legacy URL shape).
app.get('/api/v1/delivery/:sessionId/artifact', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const milestoneId = req.query.milestone ?? 'm1';
  const record = getDeliveryRecord(session.session_id, milestoneId);
  if (!record) {
    return res.status(409).json({ error: 'not_dispatched', message: `Merchant has not dispatched milestone '${milestoneId}' yet.` });
  }

  recordAccess(session.session_id, milestoneId, {
    clientIp: req.ip,
    userAgent: req.get('user-agent') || 'unknown',
    accessedAt: new Date().toISOString(),
  });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="scopegate-deliverable-${session.session_id}-${milestoneId}.txt"`);
  res.send(renderArtifact(session, milestoneId));
});

// One-click Seller Protection Intangible-Goods evidence package. `?milestone=mN` scopes the
// proof of delivery to that stage; default is the latest accepted milestone. The dossier
// always embeds the full payment ledger (every milestone order + capture id).
app.get('/api/v1/sessions/:sessionId/dossier', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const milestoneId = resolveEvidenceMilestone(session, req.query.milestone);
  if (!milestoneId) {
    return res.status(409).json({ error: 'evidence_incomplete', message: 'Dispatch a milestone deliverable and let the recipient download it first.' });
  }
  const record = getDeliveryRecord(session.session_id, milestoneId);
  res.json(buildDossier(session, record, milestoneId));
});

// The same dossier as a downloadable defense-letter PDF (Seller Protection Intangible-Goods).
app.get('/api/v1/sessions/:sessionId/dossier/pdf', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const milestoneId = resolveEvidenceMilestone(session, req.query.milestone);
  if (!milestoneId) {
    return res.status(409).json({ error: 'evidence_incomplete', message: 'Dispatch a milestone deliverable and let the recipient download it first.' });
  }
  const record = getDeliveryRecord(session.session_id, milestoneId);
  const pdf = buildDefenseLetterPdf(buildDossier(session, record, milestoneId));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="scopegate-defense-letter-${session.session_id}-${milestoneId}.pdf"`);
  res.send(pdf);
});

// Preview of the exact evidence_info payload that would be POSTed to
// /v1/customer/disputes/{id}/provide-evidence for this session (+ optional milestone).
app.get('/api/v1/sessions/:sessionId/evidence-payload', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const milestoneId = resolveEvidenceMilestone(session, req.query.milestone);
  if (!milestoneId) {
    return res.status(409).json({ error: 'evidence_incomplete', message: 'Dispatch + download must happen before evidence exists.' });
  }
  const record = getDeliveryRecord(session.session_id, milestoneId);
  res.json({
    provide_evidence_endpoint: 'POST /v1/customer/disputes/{dispute_id}/provide-evidence',
    evidence_type: 'PROOF_OF_FULFILLMENT',
    multipart_parts: ['input (application/json)', 'files: defense letter PDF'],
    evidence_info: buildEvidencePayload(buildDossier(session, record, milestoneId), session),
  });
});

// Fire the real Disputes API call against a live dispute id (phase 2 route).
app.post('/api/v1/disputes/:disputeId/provide-evidence', async (req, res) => {
  const session = getSession(req.body?.session_id);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const milestoneId = resolveEvidenceMilestone(session, req.body?.milestone_id);
  if (!milestoneId) {
    return res.status(409).json({ error: 'evidence_incomplete', message: 'Dispatch + download must happen before evidence exists.' });
  }
  const record = getDeliveryRecord(session.session_id, milestoneId);
  try {
    const dossier = buildDossier(session, record, milestoneId);
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

/**
 * Match an event resource back to its session (+ payment slot) via order id, capture id,
 * or the contract-hash anchor. Milestone orders carry custom_id = `${hash}:mN`, so the
 * hash check accepts both the exact hash (legacy/contract-level events) and the
 * `hash:` prefix (milestone-scoped events).
 */
function matchSession(resource = {}) {
  const ids = new Set();
  const tx = resource.disputed_transactions?.[0] ?? {};
  for (const v of [resource.custom_id, resource.id, tx.seller_transaction_id, tx.related_transaction_id]) {
    if (typeof v === 'string' && v) ids.add(v);
  }
  if (ids.size === 0) return { session: null, payment: null };
  for (const session of sessions.values()) {
    const payment = session.payments?.find(
      (p) => (p.order_id && ids.has(p.order_id)) || (p.capture_id && ids.has(p.capture_id)),
    );
    if (payment) return { session, payment };
    const hash = session.decision.contract_hash;
    if (hash && [...ids].some((id) => id === hash || id.startsWith(`${hash}:`))) {
      // Hash matched but no order/capture slot did (e.g. a dispute-level resource):
      // attribute the session; milestone attribution happens from custom_id if present.
      const milestoneId = [...ids].find((id) => id.startsWith(`${hash}:`))?.split(':')[1] ?? null;
      return { session, payment: milestoneId ? paymentFor(session, milestoneId) : null };
    }
  }
  return { session: null, payment: null };
}

function applyWebhookEvent(event) {
  const { session, payment } = matchSession(event.resource ?? {});
  if (!session) return null;
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED' && payment) {
    payment.order_status = 'COMPLETED';
    payment.capture_id = payment.capture_id ?? event.resource?.id ?? null;
    payment.captured_at = event.create_time ?? new Date().toISOString();
  }
  if (event.event_type === 'CHECKOUT.ORDER.APPROVED' && payment) {
    payment.order_status = payment.order_status === 'COMPLETED' ? payment.order_status : 'APPROVED';
  }
  if (event.event_type === 'CUSTOMER.DISPUTE.CREATED') {
    const customId = event.resource?.custom_id
      ?? event.resource?.disputed_transactions?.[0]?.custom_id
      ?? null;
    session.dispute = {
      dispute_id: event.resource?.dispute_id ?? event.resource?.id ?? null,
      reason: event.resource?.reason ?? null,
      status: event.resource?.status ?? 'OPEN',
      amount: event.resource?.dispute_amount?.value ?? null,
      milestone_id: typeof customId === 'string' && customId.includes(':') ? customId.split(':')[1] : null,
      created_at: event.create_time,
    };
  }
  return { session_id: session.session_id, milestone_id: payment?.milestone_id ?? null };
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
    const matched = applyWebhookEvent(event);
    webhookEvents.unshift({
      id: event.id,
      event_type: event.event_type,
      create_time: event.create_time,
      verified: true,
      matched_session: matched?.session_id ?? null,
      matched_milestone: matched?.milestone_id ?? null,
      resource_summary: {
        id: event.resource?.id ?? null,
        amount: event.resource?.amount?.value ?? event.resource?.dispute_amount?.value ?? null,
        reason: event.resource?.reason ?? null,
      },
      received_at: new Date().toISOString(),
    });
    webhookEvents.length = Math.min(webhookEvents.length, WEBHOOK_EVENT_LIMIT);
    console.log(`[webhook] VERIFIED ${event.event_type} (${event.id}) → session ${matched?.session_id ?? 'no match'}${matched?.milestone_id ? ` / ${matched.milestone_id}` : ''}`);
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
