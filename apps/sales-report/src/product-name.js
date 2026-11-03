/**
 * 商品名称解析：付款凭证 OCR 得到的商品名往往同时包含「型号」「配置码」，
 * 还会把型号行重复追加一次（形如 `...[型号:...]`）。
 * 这里统一剥离重复后缀，并拆出可读的型号与配置，供图表与表格分别使用。
 */

// OCR 常把型号行再识别一遍追加在末尾，可能带 [ 或不带
function stripModelSuffix(value) {
  return String(value || '')
    .replace(/[\[\s]*型?\s*号\s*[:：][\s\S]*$/i, '')
    .replace(/[\s\[]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// OCR 偶发把「数量」列标题混入商品名
function stripNoise(value) {
  return stripModelSuffix(value).replace(/^数量\s+/i, '').trim();
}

const SERIES_RULES = [
  /^(legion\s+[a-z]\d{3,4}[a-z]*)/i,
  /^(loq\s+\d+[a-z]*)/i,
  /^(yoga\s+(?:air|pro|slim|book)?\s*\d+(?:\s*s)?(?:\s+(?:ultra|pro|air))?)/i,
  /^(小新\s*(?:pro|air|plus)?\s*\d+[a-z]*)/i,
  /^(拯救者\s*[a-z]?\d*[a-z]*)/i,
  /^(斗战者\s*[a-z]{0,2}\d{2,4}[a-z0-9]{0,4})/i,
  /^(lec[o0]{1,2}\s*[a-z]?\d{2,4}[a-z]*)/i,
  /^(thinkpad\s+[a-z]+\d*)/i,
  /^(thinkbook\s+\d+[a-z]*)/i,
  /^(ideapad\s+\w+)/i,
  /^(tb\d{3}\s*[a-z0-9]*)/i,
];

// OCR 常把中文系列名后的英文子系列写成大写（小新PrO16），这里统一回正常写法
function normalizeCnSuffix(series) {
  return series.replace(/(pro|air|plus)/gi, (matched) => {
    const lower = matched.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

function normalizeBrand(series) {
  const stripped = series
    .replace(/^lec[o0]{1,2}\s*/i, 'Lecoo ')
    .replace(/^legion\s*/i, 'Legion ')
    .replace(/^loq\s*/i, 'LOQ ')
    .replace(/^yoga\s*/i, 'YOGA ')
    .replace(/^thinkpad\s*/i, 'ThinkPad ')
    .replace(/^thinkbook\s*/i, 'ThinkBook ')
    .replace(/^ideapad\s*/i, 'IdeaPad ')
    .replace(/^tb\s*/i, 'TB')
    .replace(/\s+/g, ' ')
    .trim();
  // 仅对中文系列名（小新/拯救者/斗战者）做英文子系列的大小写归一
  return /^(小新|拯救者|斗战者)/.test(stripped) ? normalizeCnSuffix(stripped) : stripped;
}

export function extractSeries(value) {
  const base = stripNoise(value);
  for (const pattern of SERIES_RULES) {
    const matched = pattern.exec(base);
    if (matched) return normalizeBrand(matched[1]);
  }
  return null;
}

/**
 * 图表用的短标签：优先取「品牌 + 型号」，未命中规则时按字符数兜底。
 */
export function toShortLabel(value, maxLength = 20) {
  const series = extractSeries(value);
  if (series) return series.length > maxLength ? `${series.slice(0, maxLength)}…` : series;
  const base = stripNoise(value);
  return base.length > maxLength ? `${base.slice(0, maxLength)}…` : base;
}

/**
 * 表格用的拆分结果：model 为可读型号，config 为剩余配置码（可能为空）。
 */
export function splitProductName(value) {
  const base = stripNoise(value);
  const series = extractSeries(value);
  if (!series) return { model: base, config: '' };

  // 用忽略空白与大小写的位置比对，兼容原文中空格位置不一致的情况
  const compact = (text) => text.replace(/\s+/g, '').toLowerCase();
  const compactBase = compact(base);
  const compactSeries = compact(series);
  const position = compactBase.indexOf(compactSeries);
  if (position < 0) return { model: series, config: '' };

  let seen = 0;
  let cutIndex = base.length;
  for (let index = 0; index < base.length; index += 1) {
    if (/\s/.test(base[index])) continue;
    if (seen >= position + compactSeries.length) {
      cutIndex = index;
      break;
    }
    seen += 1;
  }
  return { model: series, config: base.slice(cutIndex).trim() };
}

export function toFullName(value) {
  return stripNoise(value);
}
