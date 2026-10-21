// Gatekeeper core (Master Spec §3, pain point #2, 80% of effort):
//   1. Prompt Firewall — XML-tag isolation of buyer input, instruction-injection detection.
//   2. Scope Matcher  — buyer request vs service.schema.json; one-way price ratchet.
//   3. Discrete verdict: ACCEPT | COUNTER | REJECT.
// Implementation lands in D2; this module fixes the call contract early.

export const Decision = Object.freeze({
  ACCEPT: 'ACCEPT',
  COUNTER: 'COUNTER',
  REJECT: 'REJECT',
});

export const RiskFlag = Object.freeze({
  NONE: 'NONE',
  PROMPT_INJECTION_DETECTED: 'PROMPT_INJECTION_DETECTED',
  EXPLICIT_EXCLUSION_VIOLATED: 'EXPLICIT_EXCLUSION_VIOLATED',
  RUSH_CAPACITY_SURCHARGE: 'RUSH_CAPACITY_SURCHARGE',
});

/**
 * Adjudicate a buyer-agent request against the merchant service baseline.
 * @param {{ buyer_message: string, budget_usd?: number, session_id?: string }} buyerRequest
 * @param {object} serviceBaseline - parsed schemas/service.schema.json
 * @returns {Promise<object>} decision payload shaped by schemas/decision.schema.json
 */
export async function evaluateScope(buyerRequest, serviceBaseline) {
  throw new Error('evaluateScope: lands in D2 (Master Spec roadmap)');
}
