// Delivery gateway (Master Spec §3): every artifact pickup is logged with the
// payer-verified email dispatch, access IP, user agent, timestamp, and artifact
// SHA-256 — the raw material of the dispute dossier (Seller Protection Intangible-Goods).
//
// v0.4: records are keyed per contract milestone (`session_id:milestone_id`) — each
// milestone payment gets its own dispatch + access log, so a dispute over one stage
// cites that stage's receipt without touching the others.
//
// The demo deliverable is rendered deterministically from the session's frozen
// contract, so the hash recorded at dispatch is identical to the one served on
// every subsequent download — no way to claim "the file we received differs".

import crypto from 'node:crypto';

const deliveries = new Map(); // `${session_id}:${milestone_id}` -> { payer_email, artifact_sha256, delivery_dispatched_at, accesses[] }

const key = (sessionId, milestoneId) => `${sessionId}:${milestoneId}`;

export function renderArtifact(session, milestoneId) {
  const payment = session.payments?.find((p) => p.milestone_id === milestoneId);
  const planEntry = session.decision.payment_plan?.find((m) => m.milestone_id === milestoneId);
  return [
    'ScopeGate protected deliverable',
    `session_id:    ${session.session_id}`,
    `milestone_id:  ${milestoneId}${planEntry ? ` (${planEntry.label})` : ''}`,
    `order_id:      ${payment?.order_id ?? null}`,
    `contract_hash: ${session.decision.contract_hash}`,
    `service:       ${session.decision.locked_scope.agreed_deliverables.join('; ')}`,
    `milestone_fee: ${payment ? `${payment.amount.toFixed(2)} ${session.decision.currency} captured` : 'not captured'}`,
    '',
    '(Demo artifact — in production this is the actual work product archive.)',
  ].join('\n');
}

export function artifactHash(session, milestoneId) {
  return crypto.createHash('sha256').update(renderArtifact(session, milestoneId)).digest('hex');
}

export function recordDispatch(sessionId, milestoneId, { payerEmail, artifactSha256, dispatchedAt }) {
  const record = {
    milestone_id: milestoneId,
    payer_email: payerEmail,
    artifact_sha256: artifactSha256,
    delivery_dispatched_at: dispatchedAt,
    accesses: [],
  };
  deliveries.set(key(sessionId, milestoneId), record);
  return record;
}

export function recordAccess(sessionId, milestoneId, { clientIp, userAgent, accessedAt }) {
  const record = deliveries.get(key(sessionId, milestoneId));
  if (!record) return null;
  const access = { accessed_at: accessedAt, client_ip: clientIp, user_agent: userAgent };
  record.accesses.push(access);
  return access;
}

export function getDeliveryRecord(sessionId, milestoneId) {
  return deliveries.get(key(sessionId, milestoneId)) ?? null;
}
