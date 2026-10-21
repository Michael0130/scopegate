// Dispute shield (Master Spec §3, pain point #1, 20% of effort): assembles the
// Seller Protection §11 evidence dossier from the frozen gatekeeper decision and
// the delivery access logs. Submitting through POST /v1/customer/disputes/{id}/
// provide-evidence is phase 2 — per spec, if sandbox dispute creation proves too
// heavy, this schema-perfect payload + a downloadable defense letter IS the demo.

export function buildDossier(session, deliveryRecord) {
  const lastAccess = deliveryRecord.accesses[deliveryRecord.accesses.length - 1];
  return {
    dossier_id: `dos_${session.session_id}`,
    paypal_order_id: session.order_id,
    paypal_custom_id_anchor: session.decision.contract_hash,
    policy_compliance: 'PayPal Seller Protection Policy Section 11 (Intangible Goods & Services)',
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

export async function provideEvidence(token, disputeId, dossier) {
  throw new Error('provideEvidence: phase 2 (Master Spec roadmap)');
}
