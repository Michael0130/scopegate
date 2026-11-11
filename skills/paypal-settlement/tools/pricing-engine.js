// Deterministic pricing engine (one-way ratchet): the LLM names rules, never amounts.
import crypto from 'node:crypto';

export function computeQuote(baseline, appliedSurcharges = []) {
  let price = Number(baseline.base_price || 500);
  for (const { rule, quantity } of appliedSurcharges) {
    const amount = baseline.surcharge_rules?.[rule];
    if (amount === undefined) continue; // unknown rule names are dropped, never honored
    price += Number(amount) * Math.max(1, Math.min(10, Math.floor(quantity) || 1));
  }
  return Math.round(price * 100) / 100;
}

export const MILESTONE_TEMPLATE = Object.freeze([
  { milestone_id: 'm1', label: 'Deposit (kick-off)', share: 0.4, release: 'on_contract_signing' },
  { milestone_id: 'm2', label: 'Balance (final delivery)', share: 0.6, release: 'on_acceptance_of_m1' },
]);

/** Split the quoted price into milestone amounts (integer cents; remainder -> last). */
export function planMilestones(totalPrice) {
  const totalCents = Math.round(Number(totalPrice) * 100);
  let allocated = 0;
  return MILESTONE_TEMPLATE.map((m, i) => {
    const cents = i === MILESTONE_TEMPLATE.length - 1 ? totalCents - allocated : Math.floor(totalCents * m.share);
    allocated += cents;
    return { milestone_id: m.milestone_id, label: m.label, amount: cents / 100, release: m.release };
  });
}

export const computePaymentPlan = planMilestones;

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function contractHash(frozenTerms) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(frozenTerms))).digest('hex');
}

export const hashContract = contractHash;
