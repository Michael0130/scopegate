// Dispute shield (Master Spec §3, pain point #1, 20% of effort): assembles the
// Seller Protection Intangible-Goods evidence dossier from the frozen gatekeeper decision and
// the delivery access logs, then submits PROOF_OF_FULFILLMENT through
// POST /v1/customer/disputes/{id}/provide-evidence (multipart/form-data).
//
// Sandbox access verified 2026-10-22: the app token carries
// `https://uri.paypal.com/services/disputes/update-seller` (list + provide-evidence).
// Creating a dispute from the API is not part of the public spec — a real
// dispute requires the sandbox buyer to file INR from the Resolution Center.

import { getAccessToken } from './client.js';
import crypto from 'node:crypto';

export function buildDossier(session, deliveryRecord) {
  const lastAccess = deliveryRecord.accesses[deliveryRecord.accesses.length - 1];
  return {
    dossier_id: `dos_${session.session_id}`,
    paypal_order_id: session.order_id,
    paypal_custom_id_anchor: session.decision.contract_hash,
    policy_compliance: 'PayPal Seller Protection - Intangible Goods Additional Requirements (compelling-evidence standard)',
    generated_at: new Date().toISOString(),
    contract_snapshot: {
      agreed_deliverables: session.decision.locked_scope.agreed_deliverables,
      explicit_exclusions: session.decision.locked_scope.explicit_exclusions,
      max_revisions: session.decision.locked_scope.max_revisions,
      quoted_price: session.decision.quoted_price,
    },
    proof_of_delivery: {
      verified_payer_email: deliveryRecord.payer_email,
      delivery_dispatched_at: deliveryRecord.delivery_dispatched_at,
      recipient_access_log: {
        accessed_at: lastAccess.accessed_at,
        client_ip: lastAccess.client_ip,
        user_agent: lastAccess.user_agent,
        artifact_sha256: deliveryRecord.artifact_sha256,
      },
    },
  };
}

/**
 * The exact `evidence_info` JSON part POSTed to provide-evidence. The contract
 * hash rides along as the intangible-service tracking reference — the one thing
 * PayPal's flow asks for that intangible sellers never had (docs/evidence-table.md #3).
 */
export function buildEvidencePayload(dossier, session) {
  return {
    evidences: [{
      evidence_type: 'PROOF_OF_FULFILLMENT',
      tracking_info: {
        carrier_name: 'OTHER',
        carrier_name_other: 'ScopeGate Contract Hash (SHA-256, intangible digital service)',
        tracking_number: dossier.paypal_custom_id_anchor,
        tracking_url: `https://scopegate.onrender.com/api/v1/delivery/${session.session_id}/artifact`,
      },
    }],
    notes:
      `Intangible digital service. The negotiated scope was frozen pre-payment and its SHA-256 ` +
      `hash anchored to purchase_units[0].custom_id of order ${dossier.paypal_order_id}. ` +
      `The artifact was dispatched to the payer-verified email and downloaded ` +
      `(${dossier.proof_of_delivery.recipient_access_log.accessed_at}), with a server-side ` +
      `access log and artifact hash attached as the defense letter PDF.`,
  };
}

/**
 * Submit evidence to a live dispute: multipart/form-data with the `input`
 * JSON part (NOT `evidence_info` — that part name is rejected with
 * INVALID_EVIDENCE_FILE, verified empirically 2026-10-22) and the
 * defense-letter PDF as the file attachment. Proven end-to-end against
 * sandbox dispute PP-R-LKW-10194104 (200 → dispute moved to UNDER_PAYPAL_REVIEW).
 */
export async function provideEvidence({ disputeId, dossier, session, pdfBuffer }) {
  const token = await getAccessToken();
  const BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
  const payload = buildEvidencePayload(dossier, session);

  const boundary = `----ScopeGateBoundary${crypto.randomBytes(8).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="scopegate-defense-letter.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      'utf8',
    ),
    pdfBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  const res = await fetch(`${BASE_URL}/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const data = await res.json().catch(() => ({ raw: 'non-json response' }));
  if (!res.ok) throw new Error(`provide-evidence failed (${res.status}): ${JSON.stringify(data)}`);
  return { paypal_response: data, evidence_payload: payload };
}
