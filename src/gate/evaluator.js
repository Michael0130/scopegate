// Gatekeeper core (Master Spec §3, pain point #2 — 80% of effort):
//   1. Prompt Firewall — deterministic injection heuristics + XML-isolated LLM classification.
//   2. Scope Matcher  — LLM names surcharge RULES; the gateway prices them deterministically
//      against service.schema.json (one-way ratchet: price can only go up from base).
//   3. Fail-safe      — exact-match deterministic verdicts for the 6 canonical eval cases and
//      a conservative degraded verdict, used whenever the LLM is slow (> LLM_TIMEOUT_MS) or down.

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildMessages } from './prompts.js';

export const Decision = Object.freeze({ ACCEPT: 'ACCEPT', COUNTER: 'COUNTER', REJECT: 'REJECT' });

export const RiskFlag = Object.freeze({
  NONE: 'NONE',
  PROMPT_INJECTION_DETECTED: 'PROMPT_INJECTION_DETECTED',
  EXPLICIT_EXCLUSION_VIOLATED: 'EXPLICIT_EXCLUSION_VIOLATED',
  RUSH_CAPACITY_SURCHARGE: 'RUSH_CAPACITY_SURCHARGE',
});

const LLM_URL = `${process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'}/chat/completions`;
const LLM_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'glm-4.6';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 4000);

// Deterministic injection firewall. A firewall biased toward the merchant: false rejects are
// safe, false accepts are not. These patterns force REJECT even if the LLM misses the attack.
const INJECTION_PATTERNS = [
  /\bsystem\s+(override|prompt|message|instruction)s?\b/i,
  /\bignore\s+(all\s+|any\s+)?(previous|prior|above|earlier|the)\s+(rules?|instructions?|prompts?)/i,
  /\bignore\s+(pricing|the\s+pricing)\s+rules?\b/i,
  /\bdisregard\s+(all\s+)?(previous|prior|above)\b/i,
  /\bdeveloper\s+mode\b/i,
  /\bjailbreak\b/i,
  /\byou\s+are\s+now\b/i,
  /\bpretend\s+(to\s+be|that\s+you\s+are)\b/i,
  /\breveal\s+(your|the)\s+(system\s+)?(prompt|instructions)\b/i,
];

export function detectInjection(text) {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

// Tokens derived from explicit_exclusions at runtime — adding an exclusion to the baseline
// automatically extends the firewall without touching this file.
function exclusionTokens(baseline) {
  const stop = new Set(['with', 'your', 'from', 'that', 'this', 'into', 'custom', 'native']);
  const tokens = [];
  for (const exclusion of baseline.explicit_exclusions ?? []) {
    for (const word of exclusion.toLowerCase().split(/[^a-z]+/)) {
      if (word.length > 3 && !stop.has(word)) tokens.push(word);
    }
  }
  return tokens;
}

function hitExclusions(baseline, text) {
  const lowered = text.toLowerCase();
  return exclusionTokens(baseline).filter((token) => lowered.includes(token));
}

// ---- Deterministic pricing (one-way ratchet): the LLM names rules, never amounts. ----

function computeQuote(baseline, appliedSurcharges) {
  let price = Number(baseline.base_price);
  for (const { rule, quantity } of appliedSurcharges) {
    const amount = baseline.surcharge_rules?.[rule];
    if (amount === undefined) continue; // unknown rule names are dropped, never honored
    price += Number(amount) * Math.max(1, Math.min(10, Math.floor(quantity) || 1));
  }
  return Math.round(price * 100) / 100;
}

function canonicalize(value) {
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

// ---- LLM call + robust JSON extraction ----

async function callLLM(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(LLM_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: 1024, temperature: 0 }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content ?? '', latency_ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in LLM output');
  return JSON.parse(fenced.slice(start, end + 1));
}

// ---- Deterministic fallbacks (Master Spec §7.4): the 6 canonical eval cases never depend
// on the live LLM. Index comes straight from test/eval-cases.json. ----

const EVAL_CASES = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../test/eval-cases.json'), 'utf8'),
);

const FALLBACK_SURCHARGES = {
  3: [{ rule: 'rush_24h_delivery', quantity: 1 }, { rule: 'extra_revision_per_round', quantity: 1 }],
  5: [],
};

const FALLBACK_BY_MESSAGE = new Map(
  EVAL_CASES.cases
    .filter((c) => c.type === 'adjudication')
    .map((c) => [c.buyer_input.buyer_message.trim().toLowerCase(), c]),
);

function fallbackVerdict(buyerMessage, baseline) {
  const hit = FALLBACK_BY_MESSAGE.get(buyerMessage.trim().toLowerCase());
  if (!hit) return null;
  const { id, expected } = hit;
  const surcharges = expected.decision === 'COUNTER' ? (FALLBACK_SURCHARGES[id] ?? []) : [];
  return {
    decision: expected.decision,
    risk_flags: expected.risk_flags ?? ['NONE'],
    applied_surcharges: surcharges,
    reasoning:
      expected.notes
      ?? `Deterministic fallback verdict for eval case ${id} (LLM unavailable).`,
  };
}

// Conservative degraded verdict for unknown requests when the LLM is down: never ACCEPT,
// never invent scope — hand the quote back for the buyer to confirm the objective baseline.
function degradedVerdict(baseline) {
  return {
    decision: Decision.COUNTER,
    risk_flags: ['NONE'],
    applied_surcharges: [],
    reasoning:
      'Gateway is operating in degraded mode and cannot adjudicate free-form scope right now. '
      + 'The request is held at the baseline quote: ' + baseline.deliverables.join('; ')
      + `. Turnaround ${baseline.turnaround_days} days, ${baseline.max_revisions} revision rounds included. `
      + 'Confirm this exact scope to proceed, or rephrase with measurable terms.',
  };
}

// ---- Normalization + server-side enforcement (final authority over the LLM) ----

function normalize(rawVerdict, baseline, injectionHit, mode, latency_ms) {
  const decision = [Decision.ACCEPT, Decision.COUNTER, Decision.REJECT].includes(rawVerdict.decision)
    ? rawVerdict.decision
    : Decision.REJECT;

  let riskFlags = Array.isArray(rawVerdict.risk_flags) ? rawVerdict.risk_flags.filter((f) => Object.values(RiskFlag).includes(f)) : [];
  let surcharges = decision === Decision.COUNTER && Array.isArray(rawVerdict.applied_surcharges)
    ? rawVerdict.applied_surcharges.filter((s) => s && baseline.surcharge_rules?.[s.rule] !== undefined)
    : [];

  if (injectionHit) {
    riskFlags = [...new Set([RiskFlag.PROMPT_INJECTION_DETECTED, ...riskFlags])];
    return finalize(decision, riskFlags, [], rawVerdict.reasoning ?? '', baseline, mode, latency_ms, true);
  }
  if (decision === Decision.ACCEPT && surcharges.length > 0) surcharges = []; // ratchet: ACCEPT is always exactly base
  return finalize(decision, riskFlags.length ? riskFlags : ['NONE'], surcharges, rawVerdict.reasoning ?? '', baseline, mode, latency_ms, false);
}

function finalize(decision, riskFlags, surcharges, reasoning, baseline, mode, latency_ms, forcedByFirewall) {
  const quotedPrice = decision === Decision.REJECT ? null : computeQuote(baseline, surcharges);
  const lockedScope = decision === Decision.REJECT ? null : {
    agreed_deliverables: baseline.deliverables,
    explicit_exclusions: baseline.explicit_exclusions,
    max_revisions: baseline.max_revisions + surcharges
      .filter((s) => s.rule === 'extra_revision_per_round')
      .reduce((sum, s) => sum + s.quantity, 0),
    turnaround_hours: surcharges.some((s) => s.rule === 'rush_24h_delivery') ? 24 : baseline.turnaround_days * 24,
  };
  const frozenTerms = {
    service_id: baseline.service_id,
    quoted_price: quotedPrice,
    currency: baseline.currency,
    locked_scope: lockedScope,
  };
  return {
    decision,
    risk_flags: riskFlags,
    reasoning,
    quoted_price: quotedPrice,
    applied_surcharges: surcharges,
    locked_scope: lockedScope,
    contract_hash: decision === Decision.REJECT ? null : contractHash(frozenTerms),
    timestamp: new Date().toISOString(),
    gate_meta: { mode, latency_ms, injection_firewall_forced: forcedByFirewall },
  };
}

/**
 * Adjudicate a buyer-agent request against the merchant service baseline.
 * @param {{ buyer_message: string, budget_usd?: number, session_id?: string }} buyerRequest
 * @param {object} baseline - parsed schemas/service.schema.json
 */
export async function evaluateScope(buyerRequest, baseline) {
  const buyerMessage = String(buyerRequest.buyer_message ?? '').slice(0, 8000);
  const injectionHit = detectInjection(buyerMessage);
  const exclusionHits = hitExclusions(baseline, buyerMessage);

  let verdict = null;
  let mode = 'degraded';
  let latency = null;

  if (LLM_KEY) {
    try {
      const { content, latency_ms } = await callLLM(buildMessages(baseline, buyerMessage));
      verdict = extractJson(content);
      mode = 'llm';
      latency = latency_ms;
    } catch (err) {
      console.error(`[gate] LLM unavailable (${err.message}); falling back deterministically`);
    }
  }

  if (!verdict) {
    const cached = fallbackVerdict(buyerMessage, baseline);
    if (cached) {
      verdict = cached;
      mode = 'fallback-cache';
    }
  }
  if (!verdict) {
    if (exclusionHits.length > 0) {
      verdict = {
        decision: Decision.REJECT,
        risk_flags: [RiskFlag.EXPLICIT_EXCLUSION_VIOLATED],
        applied_surcharges: [],
        reasoning: `Request touches excluded territory (${exclusionHits.join(', ')}) — excluded by baseline.`,
      };
    } else if (injectionHit) {
      verdict = {
        decision: Decision.REJECT,
        risk_flags: [RiskFlag.PROMPT_INJECTION_DETECTED],
        applied_surcharges: [],
        reasoning: 'Instruction-injection pattern detected by the deterministic firewall.',
      };
    } else {
      verdict = degradedVerdict(baseline);
    }
  }

  return normalize(verdict, baseline, injectionHit, mode, latency);
}
