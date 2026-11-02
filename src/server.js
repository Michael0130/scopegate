import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateScope } from './gate/evaluator.js';
import { createScopedOrder, getOrder, captureOrder } from './paypal/client.js';
import { buildDossier, buildEvidencePayload, provideEvidence } from './paypal/disputes.js';
import { buildDefenseLetterPdf } from './paypal/defense-letter.js';
import { verifyWebhookSignature, getWebhookConfig, PAYPAL_TRANSMISSION_HEADERS } from './paypal/webhooks.js';
import { renderArtifact, artifactHash, recordDispatch, recordAccess, getDeliveryRecord } from './delivery/tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render's proxy: trust X-Forwarded-For so the access log records the
// real client IP (evidence quality for the dispute dossier), not ::1.
app.set('trust proxy', true);

// Multi-seller registry (v0.5): config/sellers.json defines every storefront — display
// identity, its OWN PayPal account (credentials via env-var names) and the service
// baseline the gate adjudicates against. Alex keeps schemas/service.schema.json as the
// baseline file of record; the other sellers carry their baseline inline. Money routes
// per seller: an order created for Bella settles into Bella's PayPal account, not a
// shared pot.
const sellersConfig = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'config', 'sellers.json'), 'utf8'),
);
const SELLERS = new Map(
  sellersConfig.sellers.map((entry) => [
    entry.id,
    {
      ...entry,
      baseline: entry.baseline_file
        ? JSON.parse(readFileSync(path.join(__dirname, '..', entry.baseline_file), 'utf8'))
        : entry.baseline,
    },
  ]),
);
const DEFAULT_SELLER_ID = sellersConfig.default_seller ?? SELLERS.keys().next().value;

function getSeller(id) {
  return SELLERS.get(id) ?? SELLERS.get(DEFAULT_SELLER_ID);
}

const money = (n) => '$' + Number(n).toFixed(2);

// Delivery/refund questions ("where is my deliverable?", "I want a refund") are NOT scope
// requests: the seller agent answers them from the session ledger — deterministic, no LLM,
// facts only. Everything else still goes through the gate.
const DISPUTE_INTENT = /\b(item\s+not\s+received|not\s+received|haven'?t\s+received|have\s+not\s+received|did\s+not\s+receive|didn'?t\s+receive|never\s+received|never\s+arrived|nothing\s+(arrived|received)|where\s+is\s+(my|the)\s|where'?s\s+(my|the)\s|still\s+waiting|want\s+a?\s+refund|give\s+me\s+a?\s+refund|refund|charge\s?back|chargeback|dispute|filed\s+a?\s+claim|scam)\b/i;

/** Resolve a seller's PayPal credentials from the env names declared in sellers.json.
 * Loud failure on purpose: a missing SELLER_* pair must never silently reroute one
 * seller's money into the default account. */
function sellerCredentials(seller) {
  const clientId = process.env[seller.paypal.client_id_env];
  const clientSecret = process.env[seller.paypal.client_secret_env];
  if (!clientId || !clientSecret) {
    throw new Error(`PayPal credentials missing for seller '${seller.id}' — set ${seller.paypal.client_id_env} / ${seller.paypal.client_secret_env}`);
  }
  return { clientId, clientSecret };
}

/** Every configured webhook registration — one per seller app; verified until SUCCESS.
 * Sellers whose credentials aren't configured yet are skipped (transitional deploys keep
 * the default seller fully working instead of breaking verification for everyone). */
function sellerWebhookTargets() {
  const legacy = getWebhookConfig();
  return [...SELLERS.values()]
    .map((seller) => {
      let credentials;
      try {
        credentials = sellerCredentials(seller);
      } catch {
        return null;
      }
      const webhookId = (seller.paypal.webhook_id_env && process.env[seller.paypal.webhook_id_env])
        || (seller.id === DEFAULT_SELLER_ID ? legacy.webhook_id : null);
      return webhookId ? { seller_id: seller.id, webhook_id: webhookId, credentials } : null;
    })
    .filter(Boolean);
}

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

/**
 * Evidence desk: answer a delivery/refund question from the session's own objective
 * state — what was captured, dispatched, downloaded (with IP/time), and whether a
 * dispute is already open. Deterministic by design: the seller agent quotes the
 * ledger, never improvises.
 */
function buildDisputeDeskReply(session) {
  const hh = (iso) => (iso ?? '').slice(11, 19) + 'Z';
  const payments = session.payments ?? [];
  const lines = [];
  const tail = (id) => (id ? `…${String(id).slice(-6)}` : 'n/a');

  if (session.dispute) {
    lines.push(`Open dispute on this deal: ${session.dispute.reason ?? 'item not received'} (${session.dispute.status ?? 'OPEN'})${session.dispute.simulated ? ' — simulated demo' : ''}. Evidence below is what PayPal reviews.`);
  }
  const captured = payments.filter((p) => p.order_status === 'COMPLETED');
  if (!captured.length) {
    lines.push('No milestone has been captured yet — nothing is owed or deliverable until a payment completes in PayPal.');
  }
  for (const p of captured) {
    lines.push(`${p.milestone_id} captured ${money(p.amount)} · order ${tail(p.order_id)} at ${hh(p.captured_at)} — payer ${p.payer_email ?? 'verified at capture'}`);
    const record = getDeliveryRecord(session.session_id, p.milestone_id);
    if (!record) {
      lines.push(`${p.milestone_id} not dispatched yet — dispatch lands at your verified PayPal email.`);
    } else {
      lines.push(`${p.milestone_id} dispatched ${hh(record.delivery_dispatched_at)} · artifact sha256 ${String(record.artifact_sha256 ?? '').slice(0, 12)}…`);
      const n = record.accesses?.length ?? 0;
      if (n > 0) {
        const last = record.accesses[n - 1];
        lines.push(`${p.milestone_id} downloaded ×${n} — last at ${hh(last.accessedAt)} from IP ${last.clientIp ?? 'n/a'}`);
      } else {
        lines.push(`${p.milestone_id} no download yet — check spam; every attempt is logged for the dossier.`);
      }
    }
  }
  const pending = payments.find((p) => p.order_id && p.order_status !== 'COMPLETED');
  if (pending) {
    lines.push(`${pending.milestone_id} order ${tail(pending.order_id)} exists but is not captured (${pending.order_status}) — approve it in PayPal first.`);
  }
  const hash = session.decision?.contract_hash;
  if (hash) {
    lines.push(`Frozen contract ⌾ ${hash.slice(0, 8)}…${hash.slice(-4)} anchors every fact above in PayPal's custom_id.`);
  }

  return {
    response_type: 'dispute_desk',
    session_id: session.session_id,
    seller_id: session.seller_id,
    reasoning: lines.join(' '),
    facts: { lines },
    gate_meta: { mode: 'dispute-desk', latency_ms: 0, injection_firewall_forced: false },
    timestamp: new Date().toISOString(),
  };
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

// Storefront registry: powers the marketplace stalls, the buyer-side concierge agent and
// the console's Agent-preset tab. The baselines exposed here are the exact contracts the
// gate enforces — read-only, frozen, fingerprinted.
app.get('/api/v1/sellers', (_req, res) => {
  res.json({
    default_seller: DEFAULT_SELLER_ID,
    sellers: [...SELLERS.values()].map((s) => ({
      id: s.id,
      display_name: s.display_name,
      store_domain: s.store_domain,
      store_tagline: s.store_tagline,
      concierge_blurb: s.concierge_blurb,
      agent_persona: s.agent_persona,
      keywords: s.keywords,
      paypal_email: s.paypal.email,
      baseline: s.baseline,
    })),
  });
});

// Natural-language buyer request -> ACCEPT | COUNTER | REJECT (schemas/decision.schema.json).
// `seller` selects the storefront (config/sellers.json); omitted = default seller, so the
// eval suite and legacy API consumers keep working unchanged.
app.post('/api/v1/scope/negotiate', async (req, res) => {
  const { buyer_message: buyerMessage } = req.body ?? {};
  if (!buyerMessage || typeof buyerMessage !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'buyer_message (string) is required' });
  }

  const seller = getSeller(req.body?.seller);
  const sessionId = typeof req.body.session_id === 'string' && req.body.session_id
    ? req.body.session_id
    : `req_scope_${crypto.randomBytes(6).toString('hex')}`;

  // Dispute desk intercept: delivery/refund questions against a live session are answered
  // from the ledger (no LLM, no new contract). Without a session ref the message falls
  // through to the normal gate.
  const existingSession = getSession(sessionId);
  if (existingSession && DISPUTE_INTENT.test(buyerMessage)) {
    return res.json(buildDisputeDeskReply(existingSession));
  }

  try {
    const decision = await evaluateScope({ buyer_message: buyerMessage }, seller.baseline);
    decision.session_id = sessionId;
    decision.seller_id = seller.id;

    const session = {
      session_id: sessionId,
      seller_id: seller.id,
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
    const seller = getSeller(session.seller_id);
    const order = await createScopedOrder({
      contractHash: `${session.decision.contract_hash}:${milestoneId}`,
      paypalRequestId: `${sessionId}:${milestoneId}`,
      amount: payment.amount,
      currency: seller.baseline.currency,
      description: `${seller.baseline.title} — ${payment.label}`,
      credentials: sellerCredentials(seller),
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
// for that one milestone order — into the SELLER's own PayPal account (resolved from the
// session captured in the ledger, so the money lands where the storefront said it would).
app.post('/api/v1/orders/:id/capture', async (req, res) => {
  let hit = null;
  for (const session of sessions.values()) {
    const payment = session.payments?.find((p) => p.order_id === req.params.id);
    if (payment) { hit = { session, payment }; break; }
  }
  const seller = hit ? getSeller(hit.session.seller_id) : null;
  try {
    const capture = await captureOrder(req.params.id, seller ? sellerCredentials(seller) : undefined);
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
    // PayPal's 422 ORDER_NOT_APPROVED is a normal demo beat (capture before approval) —
    // surface it as a clean 409 the console can translate into guidance, not raw JSON.
    if (err.message?.includes('ORDER_NOT_APPROVED')) {
      return res.status(409).json({ error: 'order_not_approved', message: 'The buyer has not approved this order in PayPal yet.' });
    }
    res.status(502).json({ error: 'paypal_failure', message: err.message });
  }
});

app.get('/api/v1/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  // Augment each milestone with delivery state so one poll drives the whole ladder UI.
  const payments = (session.payments ?? []).map((p) => {
    const record = getDeliveryRecord(session.session_id, p.milestone_id);
    return { ...p, dispatched: !!record, access_count: record?.accesses.length ?? 0 };
  });
  res.json({ ...session, payments });
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
    const result = await provideEvidence({
      disputeId: req.params.disputeId,
      dossier,
      session,
      pdfBuffer: pdf,
      credentials: sellerCredentials(getSeller(session.seller_id)),
    });
    session.dispute = { ...(session.dispute ?? {}), evidence_submitted_at: new Date().toISOString() };
    res.json(result);
  } catch (err) {
    console.error('[provide-evidence]', err.message);
    res.status(502).json({ error: 'paypal_failure', message: err.message });
  }
});

// Demo dispute rehearsal: injects a clearly-marked SIMULATED CUSTOMER.DISPUTE.CREATED
// event through the same matcher/state machine a real PayPal delivery uses, so the
// dispute→dossier arc is demonstrable without a live Resolution Center filing. The
// event is labelled `simulated` end-to-end (feed, session, responses) and is never
// presented as signature-verified.
app.post('/api/v1/demo/simulate-dispute', (req, res) => {
  const session = getSession(req.body?.session_id);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  const captured = (session.payments ?? []).find((p) => p.order_status === 'COMPLETED');
  if (!captured) {
    return res.status(409).json({
      error: 'nothing_captured',
      message: 'Capture a milestone first — a dispute needs a payment to dispute.',
    });
  }
  // PayPal Resolution Center reason codes (subset the demo rehearses).
  const DISPUTE_REASONS = new Set([
    'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    'UNAUTHORIZED_TRANSACTION',
  ]);
  const reason = DISPUTE_REASONS.has(req.body?.reason) ? req.body.reason : 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
  // Attribute the dispute to the latest accepted milestone (delivery disputed), else
  // the first captured one.
  const milestoneId = resolveEvidenceMilestone(session, null) ?? captured.milestone_id;
  const disputeId = 'PP-SIM-' + crypto.randomBytes(4).toString('hex');
  // Set the dispute DIRECTLY on the addressed session — never through matchSession.
  // Standard quotes share one contract hash, so hash-based routing can land a demo
  // dispute on an older sibling session; the buyer addressed THIS one by session_id.
  session.dispute = {
    dispute_id: disputeId,
    reason,
    status: 'OPEN',
    amount: String(captured.amount),
    milestone_id: milestoneId,
    created_at: new Date().toISOString(),
    simulated: true,
  };
  webhookEvents.unshift({
    id: 'SIM-' + crypto.randomBytes(6).toString('hex'),
    event_type: 'CUSTOMER.DISPUTE.CREATED',
    create_time: session.dispute.created_at,
    verified: false,
    simulated: true,
    matched_session: session.session_id,
    matched_milestone: milestoneId,
    resource_summary: {
      id: disputeId,
      amount: String(captured.amount),
      reason,
    },
    received_at: session.dispute.created_at,
  });
  webhookEvents.length = Math.min(webhookEvents.length, WEBHOOK_EVENT_LIMIT);
  res.json({ session_id: session.session_id, dispute: session.dispute, simulated: true });
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
    // Multiple sellers = multiple registrations. Try each seller's webhook id (with that
    // seller's own credentials) until one returns SUCCESS — an event from Bella's app
    // only verifies against Bella's webhook id.
    let verdict = null;
    for (const target of sellerWebhookTargets()) {
      verdict = await verifyWebhookSignature(headers, req.body, target);
      if (verdict.verification_status === 'SUCCESS') break;
    }
    if (!verdict || verdict.verification_status !== 'SUCCESS') {
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
