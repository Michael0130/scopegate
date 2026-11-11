// Scope Referee - Deterministic boundary & injection checker

export const INJECTION_PATTERNS = [
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
  if (!text || typeof text !== 'string') return false;
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

const CHINESE_EXCLUSION_RULES = [
  { pattern: /(?:ios|android|原生\s*app|移动端\s*app|手机\s*app|原生应用)/i, label: 'iOS/Android 原生应用开发' },
  { pattern: /(?:postgresql|postgres|mysql|mongodb|redis|后端数据库|数据库架构|用户认证系统|鉴权系统)/i, label: '定制后端数据库与鉴权体系' },
  { pattern: /(?:支付风控|第三方风控|risk\s*modeling)/i, label: '第三方支付风控建模' },
];

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

export function checkExclusions(baseline, text) {
  if (!text || typeof text !== 'string') return [];
  const lowered = text.toLowerCase();
  const hits = exclusionTokens(baseline).filter((token) => lowered.includes(token));
  for (const rule of CHINESE_EXCLUSION_RULES) {
    if (rule.pattern.test(text) && !hits.includes(rule.label)) {
      hits.push(rule.label);
    }
  }
  return hits;
}
