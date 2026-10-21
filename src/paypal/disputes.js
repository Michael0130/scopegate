// Dispute shield (Master Spec §3, pain point #1, 20% of effort):
// format the Seller Protection §11 evidence dossier and submit it via
// POST /v1/customer/disputes/{id}/provide-evidence (PROOF_OF_FULFILLMENT).
// Scheduled for phase 2 (10/25 - 11/03); fallback if sandbox dispute creation is too
// heavy: expose the schema-perfect JSON payload + downloadable PDF defense letter.

export function buildDossier(decisionRecord, deliveryLog) {
  throw new Error('buildDossier: phase 2 (Master Spec roadmap)');
}

export async function provideEvidence(token, disputeId, dossier) {
  throw new Error('provideEvidence: phase 2 (Master Spec roadmap)');
}
