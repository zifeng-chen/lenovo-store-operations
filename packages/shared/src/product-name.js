/**
 * 商品名称归一化：OCR 识别结果在「写入数据库前」统一走这里，保证库里存的就是干净名称。
 * 前端展示层的短标签/拆分逻辑仍留在 sales-report，属于表现层策略。
 */

const CN_SERIES = /小新|拯救者|斗战者/;

// 中文系列名允许出现的英文子系列（白名单，避免误吞型号里的其它字母）
const CN_SUFFIX_WORDS = ['Pro', 'Air', 'Plus', 'Ultra', 'Slim'];

// 中文系列名后紧跟的英文子系列：仅当整段完全等于白名单里某个词（忽略大小写与形近字）时才归一，
// 否则原样保留，避免把型号（如 斗战者JX600）误改成首字母大写形式。
// 字母段允许夹一个形近数字（P1us），但必须以字母结尾；型号数字前允许有空格
const CN_SUFFIX = /(小新|拯救者|斗战者)\s*([A-Za-z][A-Za-z0-9]{0,4}[A-Za-z])(?=\s*\d)/g;

// 独立成词的英文品牌名，统一标准写法
const BRAND_WORDS = [
  [/(^|\s)legion(?=\s|$)/gi, 'Legion'],
  [/(^|\s)loq(?=\s|$)/gi, 'LOQ'],
  [/(^|\s)yoga(?=\s|$)/gi, 'YOGA'],
  [/(^|\s)thinkpad(?=\s|$)/gi, 'ThinkPad'],
  [/(^|\s)thinkbook(?=\s|$)/gi, 'ThinkBook'],
  [/(^|\s)ideapad(?=\s|$)/gi, 'IdeaPad'],
  [/(^|\s)lec[o0]{1,2}(?=\s|$)/gi, 'Lecoo'],
];

// 英文品牌名后紧跟的子系列词（YOGA PrO14s → YOGA Pro14s）
const BRAND_SUFFIX = /(Legion|LOQ|YOGA|ThinkPad|ThinkBook|IdeaPad|Lecoo)\s+([A-Za-z]{2,6})(?=\s*\d)/g;

// 型号 token：字母开头、字母数字混合，长度 2~16
const MODEL_TOKEN = /[A-Za-z][A-Za-z0-9]{1,15}/g;

// 中文系列名紧贴型号时补空格（小新14IMH10 → 小新 14IMH10）
const ZH_SERIES_HEAD = /(小新|拯救者|斗战者)\s*(?=\d)/g;

// 英文品牌名紧贴型号时补空格（LecooN155DL → Lecoo N155DL）
const BRAND_GLUED = /(Legion|LOQ|YOGA|ThinkPad|ThinkBook|IdeaPad|Lecoo)(?=[A-Z]*\d)/g;

/**
 * 修复型号 token 内的 OCR 形近字符。
 * 只处理「0 被认成字母 o」这一种情况，且必须两侧都有字母（B00k → Book），
 * 数字 1 一律不动：G1TB、16G1TB 这类容量写法里 1 是真实数字，误改成 l 会毁掉型号。
 */
function repairModelTokens(text) {
  return text.replace(MODEL_TOKEN, (token) => {
    if (!/\d/.test(token)) return token;
    // 两个字母之间夹 0：B00k → Book
    let fixed = token.replace(/([A-Za-z])(0{1,2})(?=[A-Za-z])/g, (matched, letter, zeros) => (
      letter + 'o'.repeat(zeros.length)
    ));
    // 字母后紧跟 0、再跟数字：Pr016 → Pro16（0 是字母 o）
    fixed = fixed.replace(/([A-Za-z])0(?=\d)/g, '$1o');
    return fixed;
  });
}

function stripTrailingModelSuffix(value) {
  return String(value || '')
    .replace(/[\[\s]*型?\s*号\s*[:：][\s\S]*$/i, '')
    .replace(/[\s\[]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * OCR 把 o 认成 0、把 i 认成 l。先判等原文，再判还原形近字的版本，
 * 命中白名单只做大小写归一，绝不改动字母本身（PlUS 是用户输入的大写，不是 i/l 混淆）。
 */
function repairSuffixLetters(suffix) {
  const direct = CN_SUFFIX_WORDS.find((word) => word.toLowerCase() === suffix.toLowerCase());
  if (direct) return direct;

  const restored = suffix.toLowerCase().replace(/0/g, 'o');
  const byDigit = CN_SUFFIX_WORDS.find((word) => word.toLowerCase() === restored);
  if (byDigit) return byDigit;

  // P1us 这类把 l 认成 1 的写法：只在末尾确实是 us 时才还原，避免 G1TB 里的真实数字 1 被改
  const byOne = CN_SUFFIX_WORDS.find((word) => word.toLowerCase() === restored.replace(/1/g, 'l'));
  if (byOne && /us$/i.test(suffix)) return byOne;

  // i / l 形近混淆：把其中一种读法代入白名单比对
  const byLetter = CN_SUFFIX_WORDS.find((word) => {
    const target = word.toLowerCase();
    if (target.length !== suffix.length) return false;
    return [...target].every((char, index) => {
      const actual = suffix[index].toLowerCase();
      if (actual === char) return true;
      return (char === 'i' || char === 'l') && (actual === 'i' || actual === 'l');
    });
  });
  return byLetter || null;
}

/**
 * 子系列词归一：命中白名单则返回标准写法，否则返回 null 表示不是子系列词。
 */
function normalizeSuffix(suffix) {
  return repairSuffixLetters(suffix);
}

/**
 * 归一化商品名称：剥离重复型号后缀，修复 OCR 形近字符，还原品牌与子系列大小写。
 * 即使名称未命中任何系列规则，也会完成大小写与形近字符修复。
 */
export function normalizeProductName(value) {
  let text = stripTrailingModelSuffix(value).replace(/^数量\s+/i, '').trim();
  if (!text) return '';

  text = text.replace(/^联\s*想\s*/i, '').replace(/^lenovo\s*/i, '');
  text = repairModelTokens(text);

  // 中文系列名 + 英文子系列：小新PrO16 / 小新 pr016 → 小新Pro16（同时去掉中间空格）
  text = text.replace(CN_SUFFIX, (matched, series, suffix) => {
    const canonical = normalizeSuffix(suffix);
    return canonical ? `${series}${canonical}` : matched;
  });

  // 子系列词内部被认成数字 0 的情况（PR016 → Pro16），只在该词确实紧跟数字时才修
  text = text.replace(/(小新|拯救者|斗战者)([A-Za-z]*0[A-Za-z0-9]*)(?=\s*\d)/g, (matched, series, token) => {
    const canonical = normalizeSuffix(token.replace(/0/g, 'o'));
    return canonical ? `${series}${canonical}` : matched;
  });

  for (const [pattern, replacement] of BRAND_WORDS) {
    text = text.replace(pattern, (matched, prefix) => `${prefix}${replacement}`);
  }

  text = text.replace(BRAND_SUFFIX, (matched, brand, suffix) => {
    const canonical = normalizeSuffix(suffix);
    return canonical ? `${brand} ${canonical}` : matched;
  });

  // 中文机型的型号首字母统一大写（拯救者y9000P → 拯救者Y9000P），但不碰已归一化的子系列词
  if (CN_SERIES.test(text)) {
    text = text.replace(/(小新|拯救者|斗战者)\s*([a-z])(?=\d)/g, (matched, series, letter) => (
      `${series}${letter.toUpperCase()}`
    ));
  }

  // OCR 常把品牌名和型号挤成一段（LecooN155DL、小新14IMH10），补回空格
  text = text.replace(ZH_SERIES_HEAD, '$1 ').replace(BRAND_GLUED, '$1 ');

  return text.replace(/(小新|拯救者|斗战者)(Pro|Air|Plus|Ultra|Slim)\s+(?=\d)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}
