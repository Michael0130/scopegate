// Delivery gateway (Master Spec §3): every artifact pickup is logged with the
// payer-verified email dispatch, access IP, user agent, timestamp, and artifact
// SHA-256 — the raw material of the dispute dossier. Implementation lands in D3.

const accessLogs = new Map(); // session_id -> access record[] (in-memory until D3 persistence)

export function recordDeliveryAccess(sessionId, meta) {
  throw new Error('recordDeliveryAccess: lands in D3 (Master Spec roadmap)');
}

export function getAccessLog(sessionId) {
  return accessLogs.get(sessionId) ?? [];
}
