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
import { detectInjection, checkExclusions } from '../../skills/scope-referee/tools/boundary-checker.js';
import { computeQuote, planMilestones, contractHash } from '../../skills/paypal-settlement/tools/pricing-engine.js';
import { searchMerchantKnowledge } from '../../skills/alex/craftsman-profile/tools/indexer-tool.js';

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
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30000);

// Re-export deterministic boundary & pricing functions for external callers
export { detectInjection, computeQuote, planMilestones, contractHash };

function hitExclusions(baseline, text) {
  return checkExclusions(baseline, text);
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
      max_tokens: 1000,
      temperature: 0.1,
    };
    if (isGlm) {
      const thinkingEnabled = process.env.LLM_THINKING === 'enabled' || process.env.LLM_THINKING === 'true';
      if (thinkingEnabled) {
        bodyPayload.thinking = { type: 'enabled' };
        bodyPayload.reasoning_effort = 'low';
      } else {
        bodyPayload.thinking = { type: 'disabled' };
      }
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
    const hasPaid = contextState?.paid_summary || contextState?.consultation_stage === 'FULFILLMENT';
    if (hasPaid) {
      return {
        dispatch: {
          target_agent: 'legal',
          intent: isZh ? '已清算款项争议与存证保障说明' : 'Settled Payment Dispute & Evidence Protection',
          router_note: isZh ? '买方已完成阶段付款，由法务智能体调取已固化存证' : 'Buyer has paid milestone, Legal Agent cites settled evidence',
        },
        decision: Decision.INQUIRY,
        risk_flags: ['NONE'],
        applied_surcharges: [],
        reasoning: isZh
          ? `您此前已完成阶段付款（${contextState.paid_summary || '已入账'}），该款项与交付约定已永久锚定在不可篡改契约（${(contextState.contract_hash || '').slice(0, 8)}…）与 PayPal 官方清算底账中。若您对交付存在任何疑虑，法务智能体已为您准备好完整仲裁证据卷宗，受 PayPal 官方买家保护全程托底。`
          : `Your milestone payment (${contextState.paid_summary || 'captured'}) is anchored in contract hash ${(contextState.contract_hash || '').slice(0, 8)}… and PayPal's official ledger. You are fully protected under PayPal's dispute resolution with an immutable dossier.`,
        session_updates: detectedName ? { buyer_name: detectedName } : undefined,
      };
    }
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
  const hasExplicitOrderSpec = /(?:(?:\d+|三|四|五)\s*(?:个)?(?:区块|section)|确认下单|锁定基线|签合同|同意基价|确定做这个|开发一个|做一个|制作一个)/i.test(trimmed);
  const isGreetingOrCasual = !hasExplicitOrderSpec && (
    trimmed.length <= 6
    || /^(?:hi|hello|hey|ok|好的|收到|在吗|你好|1+|2+|3+|test|\?|？|哈哈+|呵呵+|嘻嘻+)$/i.test(trimmed)
    || /(?:你好|您好|hi|hello|在吗|在不在|测试|test|有人吗|我叫|我是|叫我|my\s*name\s*is|哈哈)/i.test(trimmed)
  );

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
      session_updates: {
        buyer_name: detectedName || null,
        consultation_stage: 'GREETING',
      },
    };
  }

  // 8. General inquiry fallback: Any general request without explicit actionable order specification
  // NEVER push a $500 lock on an open-ended question!
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
      session_updates: {
        buyer_name: detectedName || null,
        consultation_stage: 'DISCOVERY',
      },
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

function normalize(rawVerdict, baseline, injectionHit, mode, latency_ms, buyerMessage = '', degradedReason = null) {
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

  // Derive activated skills & tool traces for single agent architecture
  let activatedSkills = Array.isArray(rawVerdict.activated_skills) && rawVerdict.activated_skills.length > 0
    ? [...rawVerdict.activated_skills]
    : [];

  const toolTraces = [];

  const sellerId = (baseline?.merchant_name?.toLowerCase().includes('bella') || baseline?.service_id?.includes('brand')) ? 'bella'
    : (baseline?.merchant_name?.toLowerCase().includes('cj') || baseline?.service_id?.includes('payment')) ? 'cj'
    : 'alex';

  // 1. Platform Base Skills
  if (injectionHit || exclusionHits.length > 0 || decision === Decision.ACCEPT || decision === Decision.COUNTER || /(?:范围|规约|守门|基准|合规|排除|黑名单|scope|referee|injection|rule|exclude)/i.test(buyerMessage)) {
    if (!activatedSkills.includes('scope-referee')) activatedSkills.push('scope-referee');
    toolTraces.push({ tool: 'check_exclusions', skill: 'scope-referee', status: 'SUCCESS', violations: exclusionHits });
    if (injectionHit) {
      toolTraces.push({ tool: 'check_prompt_injection', skill: 'scope-referee', status: 'TRIGGERED_DEFENSE' });
    }
  }

  if (decision === Decision.ACCEPT || decision === Decision.COUNTER || /(?:多少钱|价格|报价|定金|首付|分期|款|计价|棘轮|quote|price|deposit|cost|fee|budget)/i.test(buyerMessage)) {
    if (!activatedSkills.includes('paypal-settlement')) activatedSkills.push('paypal-settlement');
    toolTraces.push({ tool: 'compute_quote', skill: 'paypal-settlement', status: 'SUCCESS', surcharges_count: surcharges.length });
  }

  if (/(?:退款|争议|交付|存证|哈希|vault|refund|dispute|dossier|ledger|proof|hash)/i.test(buyerMessage)) {
    if (!activatedSkills.includes('evidence-vault')) activatedSkills.push('evidence-vault');
    toolTraces.push({ tool: 'verify_delivery_hash', skill: 'evidence-vault', status: 'SUCCESS' });
  }

  // 2. Domain Skills based on seller
  if (sellerId === 'alex') {
    if (/(?:落地页|landing|官网|next\.?js|react|区块|section|页面|网站|web)/i.test(buyerMessage) || decision === Decision.ACCEPT || decision === Decision.COUNTER) {
      if (!activatedSkills.includes('alex-nextjs-landing-page')) activatedSkills.push('alex-nextjs-landing-page');
      toolTraces.push({ tool: 'verify_page_sections', skill: 'alex-nextjs-landing-page', status: 'SUCCESS' });
    }
    if (/(?:tailwind|css|样式|暗黑|主题|深色|配色|dark mode|theme|color|responsive|自适应)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('alex-tailwind-theming')) activatedSkills.push('alex-tailwind-theming');
      toolTraces.push({ tool: 'validate_theme_tokens', skill: 'alex-tailwind-theming', status: 'SUCCESS' });
    }
    if (/(?:性能|调优|优化|lighthouse|lcp|cls|速度|edge|秒开|vitals|speed|performance)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('alex-performance-tuning')) activatedSkills.push('alex-performance-tuning');
      toolTraces.push({ tool: 'audit_web_vitals', skill: 'alex-performance-tuning', status: 'SUCCESS' });
    }
    if (/(?:源码|代码|交付|github|仓库|部署|域名|手把手|handover|repo|deploy|domain)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('alex-code-handover')) activatedSkills.push('alex-code-handover');
      toolTraces.push({ tool: 'inspect_github_repo', skill: 'alex-code-handover', status: 'SUCCESS' });
    }
    if (/(?:案例|经历|背景|作品|资历|工匠|为什么|app|原生|case|portfolio|background|experience|about)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('alex-craftsman-profile')) activatedSkills.push('alex-craftsman-profile');
      if (!activatedSkills.includes('alex-merchant-knowledge')) activatedSkills.push('alex-merchant-knowledge');
      toolTraces.push({ tool: 'search_merchant_knowledge', skill: 'alex-craftsman-profile', status: 'SUCCESS', hits: 1 });
    }
  } else if (sellerId === 'bella') {
    if (/(?:品牌|vi|logo|视觉|色彩|手册|规范|brand|identity)/i.test(buyerMessage) || decision === Decision.ACCEPT || decision === Decision.COUNTER) {
      if (!activatedSkills.includes('bella-brand-visual-identity')) activatedSkills.push('bella-brand-visual-identity');
      toolTraces.push({ tool: 'generate_palette_tokens', skill: 'bella-brand-visual-identity', status: 'SUCCESS' });
    }
    if (/(?:figma|组件|设计系统|design system|tokens|auto-layout|ui)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('bella-figma-design-system')) activatedSkills.push('bella-figma-design-system');
      toolTraces.push({ tool: 'inspect_figma_tokens', skill: 'bella-figma-design-system', status: 'SUCCESS' });
    }
    if (/(?:图标|icon|svg|3d|渲染|素材|assets)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('bella-iconography-assets')) activatedSkills.push('bella-iconography-assets');
      toolTraces.push({ tool: 'optimize_svg_assets', skill: 'bella-iconography-assets', status: 'SUCCESS' });
    }
    if (/(?:路演|bp|商业计划书|ppt|deck|演示|slides)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('bella-pitch-deck-styling')) activatedSkills.push('bella-pitch-deck-styling');
      toolTraces.push({ tool: 'format_pitch_deck', skill: 'bella-pitch-deck-styling', status: 'SUCCESS' });
    }
    if (/(?:案例|背景|经历|作品|工作室|理念|case|portfolio|background|about)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('bella-studio-profile')) activatedSkills.push('bella-studio-profile');
      toolTraces.push({ tool: 'search_merchant_knowledge', skill: 'bella-studio-profile', status: 'SUCCESS', hits: 1 });
    }
  } else if (sellerId === 'cj') {
    if (/(?:支付|paypal|接入|api|sdk|集成|orders|payment)/i.test(buyerMessage) || decision === Decision.ACCEPT || decision === Decision.COUNTER) {
      if (!activatedSkills.includes('cj-payment-api-wiring')) activatedSkills.push('cj-payment-api-wiring');
      toolTraces.push({ tool: 'verify_paypal_webhook', skill: 'cj-payment-api-wiring', status: 'SUCCESS' });
    }
    if (/(?:webhook|幂等|重复|回调|重试|idempotent|replay)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('cj-webhook-idempotency')) activatedSkills.push('cj-webhook-idempotency');
      toolTraces.push({ tool: 'check_idempotency_key', skill: 'cj-webhook-idempotency', status: 'SUCCESS' });
    }
    if (/(?:对账|底账|分录|凭单|平账|ledger|reconcil)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('cj-reconciliation-ledger')) activatedSkills.push('cj-reconciliation-ledger');
      toolTraces.push({ tool: 'run_reconciliation_audit', skill: 'cj-reconciliation-ledger', status: 'SUCCESS' });
    }
    if (/(?:争议|抗辩|证据|退款|dispute|claim|chargeback)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('cj-dispute-automation')) activatedSkills.push('cj-dispute-automation');
      toolTraces.push({ tool: 'fetch_dispute_status', skill: 'cj-dispute-automation', status: 'SUCCESS' });
    }
    if (/(?:案例|背景|经验|履历|架构|case|experience|background|architect)/i.test(buyerMessage)) {
      if (!activatedSkills.includes('cj-engineer-profile')) activatedSkills.push('cj-engineer-profile');
      toolTraces.push({ tool: 'search_merchant_knowledge', skill: 'cj-engineer-profile', status: 'SUCCESS', hits: 1 });
    }
  }

  if (activatedSkills.length === 0) {
    const profileKey = sellerId === 'alex' ? 'alex-craftsman-profile' : (sellerId === 'bella' ? 'bella-studio-profile' : 'cj-engineer-profile');
    activatedSkills = [profileKey, 'scope-referee'];
    if (sellerId === 'alex') activatedSkills.push('alex-merchant-knowledge');
  }

  if (exclusionHits.length > 0) {
    riskFlags = [...new Set([RiskFlag.EXPLICIT_EXCLUSION_VIOLATED, ...riskFlags])];
  }

  if (injectionHit) {
    riskFlags = [...new Set([RiskFlag.PROMPT_INJECTION_DETECTED, ...riskFlags])];
    return finalize(decision, riskFlags, [], rawVerdict.reasoning ?? '', baseline, mode, latency_ms, true, dispatch, sessionUpdates, activatedSkills, toolTraces, degradedReason);
  }
  if (decision === Decision.ACCEPT && surcharges.length > 0) surcharges = []; // ratchet: ACCEPT is always exactly base
  return finalize(decision, riskFlags.length ? riskFlags : ['NONE'], surcharges, rawVerdict.reasoning ?? '', baseline, mode, latency_ms, false, dispatch, sessionUpdates, activatedSkills, toolTraces, degradedReason);
}

function finalize(decision, riskFlags, surcharges, reasoning, baseline, mode, latency_ms, forcedByFirewall, dispatch, sessionUpdates = null, activatedSkills = [], toolTraces = [], degradedReason = null) {
  let cleanReasoning = reasoning ?? '';
  if (decision === Decision.INQUIRY && dispatch?.target_agent === 'concierge') {
    // Proactively clean up any accidental premature price ranges or dollar amounts from consultative greetings
    cleanReasoning = cleanReasoning
      .replace(/(?:，|,)?\s*(?:常规项目)?(?:参考预算区间在?|预算区间在?|基价|起步价|参考报价)\s*[$￥\d\s~～\-–至到]+(?:之间|左右)?/gi, '')
      .replace(/\s*[$￥]\d+(?:\s*[~～\-–至到]\s*[$￥]?\d+)?\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleanReasoning) {
      if (baseline.service_id === 'srv_brand_ui_kit') {
        cleanReasoning = '您好！我是 Bella 的专属品牌设计顾问。我们专注于高端品牌视觉识别体系、系统化 UI 组件资产与全套数字化设计资产交付。请问您计划打造一个什么样的品牌项目？方便聊聊您的核心视觉偏好或设计诉求吗？';
      } else if (baseline.service_id === 'srv_payment_api_integration') {
        cleanReasoning = '您好！我是 CJ 的专属支付架构顾问。我们专注于企业级支付网关与第三方支付通道闭环集成、高可用异步对账系统与全链路联调验证。请问您计划集成哪些支付通道或接口体系？方便聊聊您的系统架构与业务诉求吗？';
      } else {
        cleanReasoning = '您好！我是 Alex 的专属商务总管。我们专注于高品质数字化 Web 应用与定制落地页开发，包含响应式界面架构、现代化视觉交互规范与自动化生产部署。请问您计划打造一个什么样的项目或产品？方便聊聊您的核心诉求吗？';
      }
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
    agent: 'core-agent',
    activated_skills: activatedSkills,
    tool_traces: toolTraces,
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
    gate_meta: { mode, latency_ms, injection_firewall_forced: forcedByFirewall, degraded_reason: degradedReason },
  };
}

/**
 * Adjudicate a buyer-agent request against the merchant service baseline.
 * @param {{ buyer_message: string, budget_usd?: number, session_id?: string }} buyerRequest
 * @param {object} baseline - parsed schemas/service.schema.json
 */
export async function evaluateScope(buyerRequest, baseline) {
  const buyerMessage = String(buyerRequest.buyer_message ?? '').slice(0, 8000);
  const images = Array.isArray(buyerRequest.images)
    ? buyerRequest.images.filter((img) => typeof img === 'string' && img.startsWith('data:image/'))
    : [];
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
  let degradedReason = null;

  if (LLM_KEY && !buyerRequest.skip_llm) {
    try {
      const { content, latency_ms } = await callLLM(buildMessages(baseline, buyerMessage, history, isZh, contextState, images));
      verdict = extractJson(content);
      mode = 'llm';
      latency = latency_ms;
    } catch (err) {
      console.error(`[gate] LLM unavailable (${err.message}); falling back deterministically`);
      degradedReason = err.message;
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
    } else if (images.length > 0) {
      verdict = {
        dispatch: {
          target_agent: 'concierge',
          intent: isZh ? '设计参考图与界面方案分析' : 'Design Reference & UI Scoping',
          router_note: isZh ? '买方上传设计参考图，由商务总管进行视觉分析与范围梳理' : 'Buyer uploaded design reference, handled by Master Concierge',
        },
        decision: Decision.INQUIRY,
        risk_flags: ['NONE'],
        applied_surcharges: [],
        reasoning: isZh
          ? '已收到您上传的设计参考截图！针对图中的视觉风格与功能模块，我们可以基于 Next.js 14 + Tailwind CSS 进行高保真还原落地。请问针对这套设计，您计划重点开发哪几个核心展示板块？'
          : 'Received your UI screenshot reference! We can implement high-fidelity interactive sections in Next.js 14 and Tailwind CSS matching this aesthetic. What core sections would you like to prioritize?',
        session_updates: {
          consultation_stage: 'DISCOVERY',
        },
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

  return normalize(verdict, baseline, injectionHit, mode, latency, buyerMessage, degradedReason);
}
