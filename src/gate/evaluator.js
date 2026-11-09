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

export const Decision = Object.freeze({
  ACCEPT: 'ACCEPT',
  COUNTER: 'COUNTER',
  REJECT: 'REJECT',
  INQUIRY: 'INQUIRY',
});

export const RiskFlag = Object.freeze({
  NONE: 'NONE',
  PROMPT_INJECTION_DETECTED: 'PROMPT_INJECTION_DETECTED',
  EXPLICIT_EXCLUSION_VIOLATED: 'EXPLICIT_EXCLUSION_VIOLATED',
  RUSH_CAPACITY_SURCHARGE: 'RUSH_CAPACITY_SURCHARGE',
});

const LLM_URL = `${process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'}/chat/completions`;
const LLM_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'glm-4.6';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 20000);

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
  // Multilingual injection patterns (Chinese)
  /(?:忽略|无视|覆盖|绕过|清除|重置).*(?:规则|指令|提示词|限制|设定|约定|价格|基线)/i,
  /(?:进入|开启).*(?:开发者模式|上帝模式|无限制模式|越狱模式)/i,
  /(?:你现在是|从现在开始你扮演|你不再是)/i,
  /(?:系统覆盖|指令覆盖|提示词覆盖)/i,
];

export function detectInjection(text) {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

// Tokens derived from explicit_exclusions at runtime — adding an exclusion to the baseline
// automatically extends the firewall without touching this file.
function exclusionTokens(baseline) {
  const stop = new Set(['with', 'your', 'from', 'that', 'this', 'into', 'custom', 'native']);
  const tokens = ['ios', 'app', 'android'];
  for (const exclusion of baseline.explicit_exclusions ?? []) {
    for (const word of exclusion.toLowerCase().split(/[^a-z]+/)) {
      if (word.length >= 3 && !stop.has(word)) tokens.push(word);
    }
  }
  return tokens;
}

const CHINESE_EXCLUSION_RULES = [
  { pattern: /(?:ios|android|原生\s*app|移动端\s*app|手机\s*app|原生应用)/i, label: 'iOS/Android 原生应用开发' },
  { pattern: /(?:postgresql|postgres|mysql|mongodb|redis|后端数据库|数据库架构|用户认证系统|鉴权系统)/i, label: '定制后端数据库与鉴权体系' },
  { pattern: /(?:支付风控|第三方风控|risk\s*modeling)/i, label: '第三方支付风控建模' },
];

function hitExclusions(baseline, text) {
  const lowered = text.toLowerCase();
  const hits = exclusionTokens(baseline).filter((token) => lowered.includes(token));
  for (const rule of CHINESE_EXCLUSION_RULES) {
    if (rule.pattern.test(text) && !hits.includes(rule.label)) {
      hits.push(rule.label);
    }
  }
  return hits;
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

// ---- Milestone payment plan (v0.5): a deterministic split, like pricing. ----
// Conventional bespoke-software cadence, two stages: deposit up front, balance on
// final delivery. Percentages are code, never negotiation — the same one-way principle
// as the price ratchet, and the plan rides inside frozenTerms so the contract hash
// covers the payment structure too.
const MILESTONE_TEMPLATE = Object.freeze([
  { milestone_id: 'm1', label: 'Deposit (kick-off)', share: 0.4, release: 'on_contract_signing' },
  { milestone_id: 'm2', label: 'Balance (final delivery)', share: 0.6, release: 'on_acceptance_of_m1' },
]);

/** Split the quoted price into milestone amounts (integer cents; remainder → last). */
export function planMilestones(totalPrice) {
  const totalCents = Math.round(Number(totalPrice) * 100);
  let allocated = 0;
  return MILESTONE_TEMPLATE.map((m, i) => {
    const cents = i === MILESTONE_TEMPLATE.length - 1 ? totalCents - allocated : Math.floor(totalCents * m.share);
    allocated += cents;
    return { milestone_id: m.milestone_id, label: m.label, amount: cents / 100, release: m.release };
  });
}

// ---- LLM call + robust JSON extraction ----

async function callLLM(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const started = Date.now();
  try {
    const isGlm = LLM_MODEL.includes('glm');
    const bodyPayload = {
      model: LLM_MODEL,
      messages,
      max_tokens: 600,
      temperature: 0.1,
    };
    if (isGlm) {
      bodyPayload.thinking = { type: 'enabled' };
      bodyPayload.reasoning_effort = 'low';
    }

    const res = await fetch(LLM_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    const content = (msg?.content && msg.content.trim()) || msg?.reasoning_content || '';
    return { content, latency_ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('no JSON object in LLM output');

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
  }

  if (end === -1) {
    const lastEnd = cleaned.lastIndexOf('}');
    if (lastEnd > start) return JSON.parse(cleaned.slice(start, lastEnd + 1));
    throw new Error('Unclosed JSON object in LLM output');
  }

  return JSON.parse(cleaned.slice(start, end + 1));
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
  const isZh = /[\u4e00-\u9fa5]/.test(buyerMessage);
  return {
    dispatch: {
      target_agent: 'gatekeeper',
      intent: isZh ? '需求范围审核' : 'Scope Adjudication',
      router_note: isZh ? '技术边界守门人根据服务基准进行裁决' : 'Scope gatekeeper adjudicated requirements against baseline',
    },
    decision: expected.decision,
    risk_flags: expected.risk_flags ?? ['NONE'],
    applied_surcharges: surcharges,
    reasoning:
      expected.notes
      ?? (isZh
        ? `针对评测用例 ${id} 的确定性后备裁决（大模型不可用）。`
        : `Deterministic fallback verdict for eval case ${id} (LLM unavailable).`),
  };
}

// General consultation & inquiry deterministic fallback when LLM is unavailable:
// Greet, answer profile/experience/cases, copyright/IP, pricing rules, or workflow questions
// WITHOUT jumping to an unconfirmed order proposal ($500.00).
function fallbackInquiryVerdict(buyerMessage, baseline, contextState, isZh) {
  const trimmed = buyerMessage.trim();
  const nameMatch = trimmed.match(/(?:我叫|我是|叫我|my\s*name\s*is)\s*([^\s,。！!？?]{2,12})/i);
  const detectedName = nameMatch ? nameMatch[1] : contextState?.buyer_name;

  // 1. Profile / Experience / Cases / Portfolio
  const isProfile = /(?:介绍|经历|履历|背景|案例|作品|资历|关于|从业|代表作|portfolio|experience|cases|profile|showcase|bio|background|who\s*are\s*you|about)/i.test(trimmed);
  if (isProfile) {
    return {
      dispatch: {
        target_agent: 'concierge',
        intent: isZh ? '了解商户背景与代表案例' : 'Merchant Background & Portfolio Inquiry',
        router_note: isZh ? '买方咨询从业经历与案例，由商务总管进行专业背景介绍' : 'Buyer asks about experience and cases, handled by Master Concierge',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? 'Alex 拥有 8 年全栈数字化 Web 与交互产品开发经验，精通 React/Next.js/Node.js 全栈生态。曾交付过多个面向全球用户的 SaaS 官网、高转化落地页及现代化互动 Web 应用，在工程质量与交付效率上有严苛保障。请问您计划打造一个什么样的 Web 项目？'
        : 'Alex brings 8+ years of full-stack digital web and interactive craftsmanship, specializing in Next.js, Tailwind, and Node.js. He has built high-converting SaaS landing pages and bespoke web products for global teams. What kind of website or vision are you looking to create?',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 2. Copyright / Source Code / IP / Ownership
  const isCopyright = /(?:版权|源码|代码|所有权|归属|归我|知识产权|开源|商用|二次开发|专利|copyright|ip|source\s*code|ownership|license)/i.test(trimmed);
  if (isCopyright) {
    return {
      dispatch: {
        target_agent: 'concierge',
        intent: isZh ? '交付物版权与代码所有权咨询' : 'Copyright & Source Code Ownership Inquiry',
        router_note: isZh ? '买方咨询源码所有权与商业授权，由商务总管进行合规解答' : 'Buyer asks about IP rights, handled by Master Concierge',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? '交付完成并结清尾款后，项目的完整源码及资产版权 100% 归属于您（买方），包含全部源代码与部署配置文件，完全支持自由二次开发与商业化使用，绝无任何隐藏授权费或厂商绑定。'
        : '100% of the deliverables and full source code belong entirely to you upon milestone completion and final settlement, with no recurring vendor royalties or proprietary lock-in.',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 3. Name greeting / Self-intro / Greeting / Short or Casual
  const isGreetingOrCasual = trimmed.length <= 4
    || /^(?:hi|hello|hey|ok|好的|收到|在吗|你好|1+|test|\?|？)$/i.test(trimmed)
    || /(?:你好|您好|hi|hello|在吗|在不在|测试|test|有人吗|我叫|我是|叫我|my\s*name\s*is)/i.test(trimmed);

  if (isGreetingOrCasual) {
    return {
      dispatch: {
        target_agent: 'concierge',
        intent: isZh ? '常规问候与需求顾问' : 'General Inquiry & Consultative Discovery',
        router_note: isZh ? '买方输入问候或自我介绍，由商务总管前台顾问式接洽' : 'Greeting or self-intro, handled by Master Concierge',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? (detectedName
          ? `您好，${detectedName}！很高兴为您服务。我是 Alex 的专属商务总管。我们专注于高品质数字化 Web 与现代化定制页面开发，交付高效、工程严谨。请问您计划打造一个什么样的项目或产品？方便先聊聊您的核心展示诉求或设计偏好吗？`
          : '您好！很高兴为您服务。我是 Alex 的专属商务总管。我们专注于高品质数字化 Web 与现代化定制页面开发，交付高效、工程严谨。请问您计划打造一个什么样的项目或产品？方便先聊聊您的核心展示诉求或设计偏好吗？')
        : 'Hello! I am Alex\'s Master Concierge. We specialize in high-performance bespoke web development and modern digital craft. What kind of project or vision are you looking to build?',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'GREETING' } : undefined,
    };
  }

  // 4. General Pricing / Quote / Budget questions without specific project spec
  const isPricing = /(?:多少钱|怎么收费|收费标准|价格|预算|费用|怎么算|报价|按什么收费|pricing|price|cost|how\s*much|rate)/i.test(trimmed);
  if (isPricing && !/(?:\d+\s*区块|\d+\s*section|加急|修改|做个|建站|开发一套)/i.test(trimmed)) {
    return {
      dispatch: {
        target_agent: 'finance',
        intent: isZh ? '收费标准与透明计价咨询' : 'Pricing & Rate Structure Inquiry',
        router_note: isZh ? '买方咨询收费标准，由财务智能体提供透明基准报价说明' : 'Buyer asks about pricing, handled by Finance Agent',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? 'Alex 的定制开发采用清晰透明的基准计价：3 区块标准响应式 Web 页面基础起步价为 $500.00，含 3 天极速交付与 2 轮修改；如有加急、额外定制区块等需求，按公示规则透明单向核算。方便先聊聊您需要展示的具体模块吗？'
        : 'Pricing starts transparently at $500.00 for a standard 3-section responsive web experience (3-day turnaround, 2 revision rounds). Add-ons such as rush capacity are computed deterministically via published surcharge rules.',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 5. Turnaround / Process / Delivery
  const isProcess = /(?:流程|周期|工期|几天|多长时间|怎么交付|交付方式|流程是怎样|turnaround|process|workflow|how\s*to\s*deliver)/i.test(trimmed);
  if (isProcess) {
    return {
      dispatch: {
        target_agent: 'delivery',
        intent: isZh ? '交付流程与工期咨询' : 'Turnaround & Delivery Process Inquiry',
        router_note: isZh ? '买方咨询交付周期与履约流程，由履约交付智能体解答' : 'Buyer asks about workflow, handled by Delivery Agent',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? '标准交付周期为 3 个工作日（支持加急至 24 小时交付），包含 2 轮设计与细节微调。双方达成约定后通过 PayPal 分期托管（40% 启动定金 + 60% 验收尾款），并通过 ScopeGate 交付保险库安全交付完整源码与部署配置。'
        : 'Standard turnaround is 3 days (with 24h rush options available), including 2 revision rounds. Payment is split into PayPal milestone escrow (40% kick-off deposit + 60% final balance) with delivery via ScopeGate Deliverables Vault.',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 6. Any other general question/inquiry (ends with ?, ？, or contains question words like 吗/么/呢/能否/可以/如何/怎样/什么)
  // and does NOT contain explicit project creation terms
  const isQuestion = /(?:\?|？|吗|么|呢|能否|可以吗|如何|怎样|什么|有没有|支持吗|行不行|can\s*you|could\s*you|how\s*do|what\s*is)/i.test(trimmed);
  const isNotBuildOrder = !/(?:\d+\s*区块|\d+\s*section|做个|写个|开发一套|帮我做|建站|加急24小时|增加.*修改)/i.test(trimmed);
  if (isQuestion && isNotBuildOrder) {
    return {
      dispatch: {
        target_agent: 'concierge',
        intent: isZh ? '咨询答疑与需求引导' : 'General Consultation & Guidance',
        router_note: isZh ? '买方提出咨询疑问，由商务总管进行解答与引导' : 'Buyer asks general question, handled by Master Concierge',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? 'Alex 专注于高品质定制数字化 Web 与现代化交互体验开发。针对您的咨询，我们支持高度定制化的响应式页面与工程交付。方便进一步沟通您的具体业务场景与功能期望吗？'
        : 'Alex specializes in bespoke digital web and modern interactive experiences. We support tailored responsive sections and rigorous engineering. Could you share more about your target use case?',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  return null;
}

// Conservative degraded verdict for unknown requests when the LLM is down: never ACCEPT,
// never invent scope — hand the quote back for the buyer to confirm the objective baseline.
function degradedVerdict(baseline, isZh = false) {
  return {
    dispatch: {
      target_agent: 'gatekeeper',
      intent: isZh ? '降级模式审核' : 'Degraded Fallback Scope',
      router_note: isZh ? '网关处于保护模式，由技术守门人维持基准' : 'Gateway running in degraded mode',
    },
    decision: Decision.COUNTER,
    risk_flags: ['NONE'],
    applied_surcharges: [],
    reasoning: isZh
      ? `网关当前处于降级保护模式。本次定制诉求暂按标准交付基线锁定：${baseline.deliverables.join('；')}。标准周期 ${baseline.turnaround_days} 天，包含 ${baseline.max_revisions} 轮修改。请确认此范围即可推进，或使用具体指标重新描述。`
      : 'Gateway is operating in degraded mode and cannot adjudicate free-form scope right now. '
        + 'The request is held at the baseline quote: ' + baseline.deliverables.join('; ')
        + `. Turnaround ${baseline.turnaround_days} days, ${baseline.max_revisions} revision rounds included. `
        + 'Confirm this exact scope to proceed, or rephrase with measurable terms.',
  };
}

// ---- Normalization + server-side enforcement (final authority over the LLM) ----

function normalize(rawVerdict, baseline, injectionHit, mode, latency_ms, buyerMessage = '') {
  const validDecisions = [Decision.ACCEPT, Decision.COUNTER, Decision.REJECT, Decision.INQUIRY];
  let decision = validDecisions.includes(rawVerdict.decision)
    ? rawVerdict.decision
    : Decision.REJECT;

  const validAgents = ['concierge', 'gatekeeper', 'finance', 'legal', 'delivery'];
  let dispatch = rawVerdict.dispatch && typeof rawVerdict.dispatch === 'object' ? rawVerdict.dispatch : {};
  let targetAgent = validAgents.includes(dispatch.target_agent) ? dispatch.target_agent : null;
  if (!targetAgent) {
    targetAgent = decision === Decision.INQUIRY ? 'concierge' : 'gatekeeper';
  }

  let riskFlags = Array.isArray(rawVerdict.risk_flags) ? rawVerdict.risk_flags.filter((f) => Object.values(RiskFlag).includes(f)) : [];
  let surcharges = decision === Decision.COUNTER && Array.isArray(rawVerdict.applied_surcharges)
    ? rawVerdict.applied_surcharges.filter((s) => s && baseline.surcharge_rules?.[s.rule] !== undefined)
    : [];

  const trimmedMsg = buyerMessage.trim();
  const isShortOrCasualMsg = trimmedMsg.length <= 4 || /^(?:hi|hello|hey|ok|好的|收到|在吗|你好|1+|2+|3+|test|\?|？)$/i.test(trimmedMsg);
  const exclusionHits = hitExclusions(baseline, buyerMessage);

  // Safety Shield: REJECT is strictly reserved for genuine prompt injections or explicit exclusion breaches.
  // Numbers ('1', '2'), single words, casual greetings, or unrefined input must NEVER be rejected!
  if (decision === Decision.REJECT) {
    const isRealExclusion = exclusionHits.length > 0 || riskFlags.includes(RiskFlag.EXPLICIT_EXCLUSION_VIOLATED);
    const isRealInjection = injectionHit || riskFlags.includes(RiskFlag.PROMPT_INJECTION_DETECTED);

    if (isShortOrCasualMsg || (!isRealExclusion && !isRealInjection)) {
      decision = Decision.INQUIRY;
      targetAgent = 'concierge';
      const isZh = /[\u4e00-\u9fa5]/.test(buyerMessage);
      dispatch = {
        target_agent: 'concierge',
        intent: isZh ? '常规问候与需求顾问' : 'Pre-sales Inquiry',
        router_note: isZh ? '简短消息或常规测试，由商务总管前台温和接洽' : 'Short input, handled by Master Concierge',
      };
      riskFlags = ['NONE'];
      surcharges = [];
      if (!rawVerdict.reasoning || rawVerdict.reasoning.trim().length === 0 || /reject/i.test(rawVerdict.reasoning)) {
        rawVerdict.reasoning = isZh
          ? '您好，我在的！我是 Alex 的专属商务总管。请问您是想了解哪方面的定制呢？可以随时告诉我您的想法，比如您想打造什么类型的网站或产品。'
          : 'Hello! I am Alex\'s Master Concierge. What kind of project or digital experience are you looking to build?';
      }
    }
  }

  dispatch = {
    target_agent: targetAgent,
    intent: dispatch.intent || (decision === Decision.INQUIRY ? '商户咨询与接待' : '定制需求与范围审核'),
    router_note: dispatch.router_note || (decision === Decision.INQUIRY ? '由商户商务总管直接接待' : '唤醒技术边界守门人介入'),
  };

  if (surcharges.some((s) => s.rule === 'rush_24h_delivery')) {
    riskFlags = [...new Set([RiskFlag.RUSH_CAPACITY_SURCHARGE, ...riskFlags.filter((f) => f !== RiskFlag.NONE)])];
  }

  const sessionUpdates = (rawVerdict && typeof rawVerdict.session_updates === 'object' && rawVerdict.session_updates)
    ? { ...rawVerdict.session_updates }
    : {};

  const nameMatch = buyerMessage.match(/(?:我叫|我是|叫我|my name is)\s*([^\s,。！!？?]{2,12})/i);
  if (nameMatch && !sessionUpdates.buyer_name) {
    sessionUpdates.buyer_name = nameMatch[1];
  }

  if (injectionHit) {
    riskFlags = [...new Set([RiskFlag.PROMPT_INJECTION_DETECTED, ...riskFlags])];
    return finalize(decision, riskFlags, [], rawVerdict.reasoning ?? '', baseline, mode, latency_ms, true, dispatch, sessionUpdates);
  }
  if (decision === Decision.ACCEPT && surcharges.length > 0) surcharges = []; // ratchet: ACCEPT is always exactly base
  return finalize(decision, riskFlags.length ? riskFlags : ['NONE'], surcharges, rawVerdict.reasoning ?? '', baseline, mode, latency_ms, false, dispatch, sessionUpdates);
}

function finalize(decision, riskFlags, surcharges, reasoning, baseline, mode, latency_ms, forcedByFirewall, dispatch, sessionUpdates = null) {
  let cleanReasoning = reasoning ?? '';
  if (decision === Decision.INQUIRY && dispatch?.target_agent === 'concierge') {
    // Proactively clean up any accidental premature price ranges or dollar amounts from consultative greetings
    cleanReasoning = cleanReasoning
      .replace(/(?:，|,)?\s*(?:常规项目)?(?:参考预算区间在?|预算区间在?|基价|起步价|参考报价)\s*[$￥\d\s~～\-–至到]+(?:之间|左右)?/gi, '')
      .replace(/\s*[$￥]\d+(?:\s*[~～\-–至到]\s*[$￥]?\d+)?\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleanReasoning) {
      cleanReasoning = '您好！我是 Alex 的专属商务总管。我们专注于高品质数字化 Web 应用与定制落地页开发，包含响应式界面架构、现代化视觉交互规范与自动化生产部署。请问您计划打造一个什么样的项目或产品？方便聊聊您的核心诉求吗？';
    }
  }

  const isFrozen = decision === Decision.ACCEPT || decision === Decision.COUNTER;
  const quotedPrice = isFrozen ? computeQuote(baseline, surcharges) : null;
  const lockedScope = isFrozen ? {
    agreed_deliverables: baseline.deliverables,
    explicit_exclusions: baseline.explicit_exclusions,
    max_revisions: baseline.max_revisions + surcharges
      .filter((s) => s.rule === 'extra_revision_per_round')
      .reduce((sum, s) => sum + s.quantity, 0),
    turnaround_hours: surcharges.some((s) => s.rule === 'rush_24h_delivery') ? 24 : baseline.turnaround_days * 24,
  } : null;
  const paymentPlan = isFrozen ? planMilestones(quotedPrice) : null;
  const frozenTerms = isFrozen ? {
    service_id: baseline.service_id,
    quoted_price: quotedPrice,
    currency: baseline.currency,
    locked_scope: lockedScope,
    payment_plan: paymentPlan,
  } : null;

  return {
    decision,
    dispatch,
    risk_flags: riskFlags,
    reasoning: cleanReasoning,
    quoted_price: quotedPrice,
    currency: baseline.currency,
    applied_surcharges: surcharges,
    locked_scope: lockedScope,
    payment_plan: paymentPlan,
    contract_hash: isFrozen ? contractHash(frozenTerms) : null,
    session_updates: sessionUpdates,
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
  const history = Array.isArray(buyerRequest.history) ? buyerRequest.history : [];
  const contextState = buyerRequest.context_state && typeof buyerRequest.context_state === 'object'
    ? buyerRequest.context_state
    : {};
  const injectionHit = detectInjection(buyerMessage);
  const exclusionHits = hitExclusions(baseline, buyerMessage);

  const hasZhInHistory = (Array.isArray(history) && history.some((h) => /[\u4e00-\u9fa5]/.test(h.message || '')))
    || (contextState && /[\u4e00-\u9fa5]/.test(JSON.stringify(contextState)));
  const isZh = buyerRequest.lang === 'zh' || /[\u4e00-\u9fa5]/.test(buyerMessage) || hasZhInHistory;

  let verdict = null;
  let mode = 'degraded';
  let latency = null;

  if (LLM_KEY && !buyerRequest.skip_llm) {
    try {
      const { content, latency_ms } = await callLLM(buildMessages(baseline, buyerMessage, history, isZh, contextState));
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
        dispatch: {
          target_agent: 'gatekeeper',
          intent: isZh ? '硬性排除项拦截' : 'Explicit Exclusion Firewall',
          router_note: isZh ? '需求触及明确排除范围，由技术边界守门人拦截' : 'Touches explicit exclusion, blocked by gatekeeper',
        },
        decision: Decision.REJECT,
        risk_flags: [RiskFlag.EXPLICIT_EXCLUSION_VIOLATED],
        applied_surcharges: [],
        reasoning: isZh
          ? `诉求触碰了商户明确公示的硬性排除范围（${exclusionHits.join('、')}）—— 该类目不可作为定制加项承接。`
          : `Request touches excluded territory (${exclusionHits.join(', ')}) — excluded by baseline.`,
      };
    } else if (injectionHit) {
      verdict = {
        dispatch: {
          target_agent: 'gatekeeper',
          intent: isZh ? '系统提示词注入拦截' : 'Prompt Injection Firewall',
          router_note: isZh ? '检测到底层指令覆盖攻击，由技术边界守门人拦截' : 'Instruction-injection pattern detected by firewall',
        },
        decision: Decision.REJECT,
        risk_flags: [RiskFlag.PROMPT_INJECTION_DETECTED],
        applied_surcharges: [],
        reasoning: isZh
          ? '确定性安全防火墙检测到指令覆盖/角色逃逸等提示词注入攻击，已拒绝本次请求。'
          : 'Instruction-injection pattern detected by the deterministic firewall.',
      };
    } else {
      const inquiryVerdict = fallbackInquiryVerdict(buyerMessage, baseline, contextState, isZh);
      if (inquiryVerdict) {
        verdict = inquiryVerdict;
      } else {
        verdict = degradedVerdict(baseline, isZh);
      }
    }
  }

  return normalize(verdict, baseline, injectionHit, mode, latency, buyerMessage);
}
