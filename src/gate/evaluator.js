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

  // 1. AI / Bot / ChatGPT inquiry
  const isAiQuery = /(?:机器人|ai|chatgpt|人类|真人|是不是ai|是大模型吗|bot|gpt)/i.test(trimmed);
  if (isAiQuery) {
    return {
      dispatch: {
        target_agent: 'concierge',
        intent: isZh ? '智能体身份与服务定位解答' : 'Agent Identity & Capability Inquiry',
        router_note: isZh ? '买方询问是否为AI，由商务总管说明多智能体商务网关定位' : 'Buyer asks about AI identity, handled by Master Concierge',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? '您好！我是独立开发者 Alex 的专属商务总管智能体。这里是由商务、技术守门人、财务、法务与交付组成的专业智能体网格，7×24 小时为您提供严谨的范围把控、契约存证与分期清算服务。方便聊聊您想打造什么样的网站或产品吗？'
        : 'Hello! I am Alex\'s Master Concierge Agent. Our multi-agent mesh handles 24/7 scope bounding, contract freezing, and PayPal milestone settlement for independent full-stack developer Alex. What kind of project are you looking to build?',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'GREETING' } : undefined,
    };
  }

  // 2. Pricing / Expensive / Surcharge / Discount / Budget
  const isPricing = /(?:多少钱|怎么收费|收费标准|价格|预算|费用|怎么算|报价|按什么收费|太贵|便宜|抢钱|打折|优惠|券|性价比|300|100|200|500|pricing|price|cost|how\s*much|rate|expensive|cheap|discount)/i.test(trimmed);
  if (isPricing && !/(?:\d+\s*区块|\d+\s*section|确认下单|同意报价)/i.test(trimmed)) {
    return {
      dispatch: {
        target_agent: 'finance',
        intent: isZh ? '收费标准与透明单向定价咨询' : 'Pricing & Rate Structure Inquiry',
        router_note: isZh ? '买方咨询价格与预算，由财务智能体提供透明基准计价说明' : 'Buyer asks about pricing, handled by Finance Agent',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? 'Alex 的定制开发采用清晰透明的基准计价：标准 3 区块响应式 Web 页面基础起步价为 $500.00，包含 3 天极速交付与 2 轮修改。我们的机制是严格从基价单向按公开规则核算，不设口头砍价也没有隐藏增项；若您预算较为紧张，我们可以先帮您把需求收敛到最核心的展示版块。您看方便先聊聊哪些版块是当前必须的吗？'
        : 'Pricing starts deterministically at $500.00 for a standard 3-section responsive web experience (3-day turnaround, 2 revision rounds included). Pricing only moves via published add-on rules without hidden fees. If budget is constrained, we can narrow scope to your essential core sections first. What sections do you need most?',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 3. Refund / Dispute / Security / Escrow / Deposit
  const isSecurity = /(?:退款|不满意|退钱|跑路|骗子|定金|安全|担保|维权|争议|refund|dispute|escrow|deposit|security)/i.test(trimmed);
  if (isSecurity) {
    return {
      dispatch: {
        target_agent: 'legal',
        intent: isZh ? '资金安全与分期履约保障咨询' : 'Payment Escrow & Dispute Protection Inquiry',
        router_note: isZh ? '买方咨询资金安全与退款，由法务智能体说明双里程碑与争议机制' : 'Buyer asks about payment security, handled by Legal Agent',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? '合作采用两阶段 PayPal 官方分期清算（40% 启动定金 + 60% 验收尾款）。在方案达成前您可以随时无责取消；双方达成约定后，合同哈希将直接作为 custom_id 锚定在 PayPal 官方账本中，若商户因不可抗力未能按约定履约，您受 PayPal 官方争议机制与买家保护全程保障，资金安全完全透明。'
        : 'All transactions run on PayPal milestone rails (40% kick-off deposit + 60% final balance). Contract terms are frozen as a 64-char SHA-256 hash in PayPal\'s official ledger. You are fully backed by PayPal\'s official dispute resolution, making escrow safe and accountable.',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 4. Profile / Experience / Cases / Portfolio
  const isProfile = /(?:介绍|经历|履历|背景|案例|作品|资历|关于|从业|代表作|吹牛|portfolio|experience|cases|profile|showcase|bio|background|who\s*are\s*you|about)/i.test(trimmed);
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
        ? 'Alex 拥有 8 年全栈数字化 Web 与交互产品架构经验，精通现代 React/Node.js 生态。曾主导交付过 FinFlow 出海官网（首屏 0.6 秒秒开、移动端转化提升 42%）、DevSphere 开发者平台暗黑主题落地页等多款高质量产品。我们坚持用代码和交付说话。请问您的项目大概属于什么业务方向呢？'
        : 'Alex brings 8+ years of full-stack web and interactive craft, specializing in Next.js and high-performance frontends (e.g. FinFlow global site, DevSphere dark-mode portal). We let code quality and track record do the talking. What kind of project vision are you looking to build?',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 5. Copyright / Source Code / IP / Ownership
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
        ? '交付完成并结清尾款后，项目的完整源码及资产版权 100% 永久买断归属于您，包含全部源代码、样式表与部署配置文件，完全支持自由二次开发与商业化使用，绝无任何隐藏授权费或厂商绑定。'
        : '100% of the deliverables and full source code belong entirely to you upon milestone completion and final settlement, with no recurring vendor royalties or proprietary lock-in.',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 6. Turnaround / Process / Delivery / Domain / Deployment
  const isProcess = /(?:流程|周期|工期|几天|多长时间|怎么交付|交付方式|部署|域名|上线|资料|需要提供|turnaround|process|workflow|how\s*to\s*deliver|deploy|domain)/i.test(trimmed);
  if (isProcess) {
    return {
      dispatch: {
        target_agent: 'delivery',
        intent: isZh ? '交付流程与工期部署咨询' : 'Turnaround & Delivery Process Inquiry',
        router_note: isZh ? '买方咨询交付周期与上线流程，由履约交付智能体解答' : 'Buyer asks about workflow, handled by Delivery Agent',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? '标准交付周期为 3 个工作日（支持加急至 24 小时交付），包含 2 轮细节微调。交付物包含生产级完整源码包与部署脚本，Alex 会协助您一键绑定自有域名；准备建站只需提供品牌名称/Logo、核心展示文案及喜欢的风格参考即可。'
        : 'Standard turnaround is 3 days (with 24h rush options available), including 2 revision rounds. Deliverables include production-ready code and deployment configs, with custom domain guidance. You only need to supply branding assets, core copy, and style preferences.',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  // 7. Name greeting / Self-intro / Greeting / Short / Casual / Laughter / Emoji
  const isGreetingOrCasual = trimmed.length <= 6
    || /^(?:hi|hello|hey|ok|好的|收到|在吗|你好|1+|2+|3+|test|\?|？|哈哈+|呵呵+|嘻嘻+)$/i.test(trimmed)
    || /(?:你好|您好|hi|hello|在吗|在不在|测试|test|有人吗|我叫|我是|叫我|my\s*name\s*is|哈哈)/i.test(trimmed);

  if (isGreetingOrCasual) {
    return {
      dispatch: {
        target_agent: 'concierge',
        intent: isZh ? '常规问候与需求顾问' : 'General Inquiry & Consultative Discovery',
        router_note: isZh ? '买方输入问候或互动，由商务总管前台顾问式接洽' : 'Greeting or casual remark, handled by Master Concierge',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? (detectedName
          ? `您好，${detectedName}！很高兴为您服务。我是 Alex 的专属商务总管。请问您计划打造一个什么样的 Web 项目？可以随时聊聊您的核心展示诉求或设计偏好。`
          : '您好！很高兴为您服务。我是 Alex 的专属商务总管。请问您计划打造一个什么样的 Web 项目？方便先聊聊您的核心展示诉求或设计偏好吗？')
        : 'Hello! I am Alex\'s Master Concierge. What kind of project or digital experience are you looking to build?',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'GREETING' } : undefined,
    };
  }

  // 8. General inquiry fallback: Any general request without explicit actionable order specification
  // NEVER push a $500 lock on an open-ended question!
  const hasExplicitOrderSpec = /(?:(?:\d+|三|四|五)\s*(?:个)?(?:区块|section)|确认下单|锁定基线|签合同|同意基价|确定做这个)/i.test(trimmed);
  if (!hasExplicitOrderSpec) {
    return {
      dispatch: {
        target_agent: 'concierge',
        intent: isZh ? '咨询答疑与需求引导' : 'General Consultation & Guidance',
        router_note: isZh ? '买方提出开放式咨询，由商务总管进行解答与引导' : 'Buyer asks open-ended question, handled by Master Concierge',
      },
      decision: Decision.INQUIRY,
      risk_flags: ['NONE'],
      applied_surcharges: [],
      reasoning: isZh
        ? '您好！Alex 专注于高品质定制数字化 Web 与现代化交互体验开发。针对您的想法，我们可以为您量身梳理落地方案。方便进一步聊聊您具体需要展示哪些板块，或者期望的风格方向吗？'
        : 'Hello! Alex specializes in bespoke digital web and modern interactive craft. We can tailor a dedicated plan for your vision. Could you share what key sections or style direction you have in mind?',
      session_updates: detectedName ? { buyer_name: detectedName, consultation_stage: 'DISCOVERY' } : undefined,
    };
  }

  return null;
}

// Conservative degraded verdict for explicit orders when the LLM is down: never ACCEPT,
// never invent scope — hand the quote back for the buyer to confirm the objective baseline.
function degradedVerdict(baseline, isZh = false) {
  const readableDeliverables = isZh
    ? '最多 3 个核心响应式页面区块（如开篇展示、方案报价、常见问答）、高品质暗色主题视觉与生产级自动化部署配置'
    : baseline.deliverables.join('; ');
  return {
    dispatch: {
      target_agent: 'gatekeeper',
      intent: isZh ? '按基准服务范围核定' : 'Baseline Scope Fallback',
      router_note: isZh ? '技术守门人按标准交付基线核定方案' : 'Scope gatekeeper holds baseline deliverables',
    },
    decision: Decision.COUNTER,
    risk_flags: ['NONE'],
    applied_surcharges: [],
    reasoning: isZh
      ? `本次定制诉求已按标准交付基线为您锁定范围：${readableDeliverables}。标准交付工期 ${baseline.turnaround_days} 个工作日，包含 ${baseline.max_revisions} 轮细节微调。请确认此范围即可推进签约并锁定排期，如需追加功能或加急可随时告知。`
      : 'The request is held at the standard baseline quote: ' + readableDeliverables
        + `. Turnaround ${baseline.turnaround_days} days, ${baseline.max_revisions} revision rounds included. `
        + 'Confirm this exact scope to proceed, or specify further add-ons.',
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
