// Delivery gateway (Master Spec §3): every artifact pickup is logged with the
// payer-verified email dispatch, access IP, user agent, timestamp, and artifact
// SHA-256 — the raw material of the dispute dossier (Seller Protection §11).
//
// The demo deliverable is rendered deterministically from the session's frozen
// contract, so the hash recorded at dispatch is identical to the one served on
// every subsequent download — no way to claim "the file we received differs".

import crypto from 'node:crypto';

const deliveries = new Map(); // session_id -> { payer_email, artifact_sha256, delivery_dispatched_at, accesses[] }

export function renderArtifact(session) {
  return [
    'ScopeGate protected deliverable',
    `session_id:    ${session.session_id}`,
    `order_id:      ${session.order_id}`,
    `contract_hash: ${session.decision.contract_hash}`,
    `service:       ${session.decision.locked_scope.agreed_deliverables.join('; ')}`,
    '',
    '(Demo artifact — in production this is the actual work product archive.)',
  ].join('\n');
}

export function artifactHash(session) {
  return crypto.createHash('sha256').update(renderArtifact(session)).digest('hex');
}

export function recordDispatch(sessionId, { payerEmail, artifactSha256, dispatchedAt }) {
  const record = {
    payer_email: payerEmail,
    artifact_sha256: artifactSha256,
    delivery_dispatched_at: dispatchedAt,
    accesses: [],
  };
  deliveries.set(sessionId, record);
  return record;
}

export function recordAccess(sessionId, { clientIp, userAgent, accessedAt }) {
  const record = deliveries.get(sessionId);
  if (!record) return null;
  const access = { accessed_at: accessedAt, client_ip: clientIp, user_agent: userAgent };
  record.accesses.push(access);
  return access;
}

export function getDeliveryRecord(sessionId) {
  return deliveries.get(sessionId) ?? null;
}
