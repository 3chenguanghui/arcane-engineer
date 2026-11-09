/**
 * a11y_measure.mjs —— 《烬》无障碍复审量化脚本（只读）
 * ------------------------------------------------------------
 * 作用：读取主文件，静态提取所有 CSS / Canvas 颜色与字号，输出：
 *   1) 文字对比度（WCAG 2.1 相对亮度公式）
 *   2) 字号清单（CSS + Canvas）
 *   3) 色盲三型模拟下的语义色 ΔE00 区分度
 *   4) 高频闪烁 / 高频运动频率
 * 不修改主文件，不启动浏览器。
 *
 * 用法：node tools/a11y_measure.mjs "D:\其他\TRAE宝\奥术工程师\index_arcane_v2.html"
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FILE = process.argv[2] || 'D:\\其他\\TRAE宝\\奥术工程师\\index_arcane_v2.html';
const buf = fs.readFileSync(FILE);
const src = buf.toString('utf8');
const MD5 = crypto.createHash('md5').update(buf).digest('hex').toUpperCase();

/* ---------- 行号定位（一次性建索引，避免重复扫描） ---------- */
const lineStarts = [0];
for (let i = 0; i < src.length; i += 1) {
  if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);
}
/** 由字符偏移取 1 基行号 */
function lineAt(idx) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/* ---------- 颜色解析 / 合成 / 对比度 ---------- */
/** 解析 CSS 颜色为 {r,g,b,a}；无法解析返回 null */
function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(',').map((v) => v.trim());
    if (parts.length < 3) return null;
    const num = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const r = num(parts[0]);
    const g = num(parts[1]);
    const b = num(parts[2]);
    const a = parts.length >= 4 ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
    return { r, g, b, a };
  }
  return null;
}
/** 把带 alpha 的前景叠到不透明背景上 */
function over(fg, bg) {
  if (!fg) return bg;
  if (!bg) return fg;
  const a = fg.a == null ? 1 : fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1
  };
}
/** WCAG 相对亮度 */
function lum(c) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
/** 对比度 */
function contrast(fg, bg) {
  const A = lum(over(fg, bg));
  const B = lum(bg);
  const hi = Math.max(A, B);
  const lo = Math.min(A, B);
  return (hi + 0.05) / (lo + 0.05);
}
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/* ---------- CSS 抽取与解析 ---------- */
const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const rules = [];
const keyframes = [];
const vars = {};

/** 注释替换为等长空格，保持偏移不变 */
function maskComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}
/** 拆分声明（尊重括号与引号） */
function splitDecls(body) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
/** 解析一段 CSS 文本为规则数组 */
function parseCss(text, baseIdx) {
  didx = 0;
  let i = 0;
  let segStart = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '}') { i += 1; segStart = i; continue; }
    if (ch !== '{') { i += 1; continue; }
    let depth = 1;
    let j = i + 1;
    while (j < n && depth > 0) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
      j += 1;
    }
    const selector = text.slice(segStart, i).trim().replace(/\s+/g, ' ');
    const body = text.slice(i + 1, j - 1);
    if (selector.startsWith('@')) {
      if (/^@(media|supports|layer|container)/i.test(selector)) {
        parseCss(body, baseIdx + i + 1);
      } else if (/^@keyframes/i.test(selector)) {
        keyframes.push({ name: selector.replace(/^@keyframes\s+/i, ''), body, line: lineAt(baseIdx + i) });
      }
    } else if (selector) {
      const decls = {};
      for (const d of splitDecls(body)) {
        const k = d.indexOf(':');
        if (k <= 0) continue;
        const prop = d.slice(0, k).trim();
        const val = d.slice(k + 1).trim();
        if (prop && !(prop in decls)) decls[prop] = val;
      }
      rules.push({ selector, body, decls, line: lineAt(baseIdx + i) });
    }
    i = j;
    segStart = j;
  }
}
let didx = 0;

let sm;
while ((sm = styleRe.exec(src)) !== null) {
  const inner = sm[1];
  const baseIdx = sm.index + sm[0].indexOf('>') + 1;
  parseCss(maskComments(inner), baseIdx);
}

/** 递归解析 var() */
function resolveVars(value, depth = 0) {
  if (!value || depth > 8) return value;
  return String(value).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (m, name, fb) => {
    const v = vars[name] != null ? vars[name] : fb;
    return v == null ? '' : resolveVars(v, depth + 1);
  });
}
/* 先收集 :root 变量（两遍：变量之间可能互相引用） */
for (let pass = 0; pass < 2; pass += 1) {
  for (const r of rules) {
    if (!/:root|(^|,)\s*html\b/.test(r.selector)) continue;
    for (const [k, v] of Object.entries(r.decls)) {
      if (k.startsWith('--')) vars[k] = resolveVars(v);
    }
  }
}
const V = (name, fallback) => {
  const v = vars[name];
  return v != null ? v : fallback;
};

/* ---------- 关键常量（从文件读取，避免脚本写死） ---------- */
const BACKDROPS = [
  { name: '页面底 --bg', c: parseColor(V('--bg', '#070b14')) },
  { name: 'surface-1', c: parseColor(V('--surface-1', '#0d1424')) },
  { name: 'surface-2', c: parseColor(V('--surface-2', '#131e33')) },
  { name: 'surface-3', c: parseColor(V('--surface-3', '#1b2942')) },
  { name: 'panel-2', c: parseColor(V('--panel-2', '#16233a')) },
  { name: '面板 panel', c: parseColor(V('--panel', '#121d31')) },
  { name: '画布地面(亮)', c: parseColor('#12233a') }
];

/* ---------- 1. 文字对比度 ---------- */
const textRows = [];
const PANEL_BASE = parseColor(V('--surface-2', '#131e33'));
for (const r of rules) {
  if (!r.decls.color) continue;
  if (/^\.(flash|danger-layer)$/.test(r.selector)) continue;
  const fgRaw = resolveVars(r.decls.color);
  const fg0 = parseColor(fgRaw);
  if (!fg0) continue;
  // 元素整体 opacity 会一起压低文字与底色的对比
  const op = parseFloat(resolveVars(r.decls.opacity || '1'));
  const opEff = (Number.isFinite(op) && op > 0) ? Math.min(1, op) : 1;
  const fg = { ...fg0, a: (fg0.a == null ? 1 : fg0.a) * opEff };
  // 该规则自身的底色：支持纯色与渐变（渐变取全部色标，逐个算，取最差）
  const bgRaw = resolveVars(r.decls['background-color'] || r.decls.background || '');
  const ownStops = [...bgRaw.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)]
    .map((m) => parseColor(m[0]))
    .filter(Boolean);
  // 自身有底色 → 文字只可能落在自己的底色上；否则按继承的通用面板色逐层取最差
  const cands = ownStops.length
    ? ownStops.map((st) => ({ name: '规则自身底色', c: over(st, PANEL_BASE) }))
    : BACKDROPS.slice();
  let worst = null;
  for (const bd of cands) {
    if (!bd.c) continue;
    const ratio = contrast(fg, bd.c);
    if (!worst || ratio < worst.ratio) worst = { ratio, bd: bd.name, bg: bd.c };
  }
  if (!worst) continue;
  // 字号
  let fsPx = null;
  if (r.decls['font-size']) {
    const fsv = resolveVars(r.decls['font-size']);
    const m = fsv.match(/([\d.]+)px/);
    if (m) fsPx = parseFloat(m[1]);
  }
  const fw = parseInt(resolveVars(r.decls['font-weight'] || '400'), 10) || 400;
  const large = fsPx != null && (fsPx >= 24 || (fsPx >= 18.66 && fw >= 700));
  const need = large ? 3 : 4.5;
  textRows.push({
    selector: r.selector,
    line: r.line,
    colorRaw: fgRaw,
    color: hex(over(fg, worst.bg)),
    alpha: fg.a,
    fontSize: fsPx,
    weight: fw,
    ratio: Number(worst.ratio.toFixed(2)),
    need,
    backdrop: worst.bd,
    pass: worst.ratio >= need
  });
}
const seenText = new Set();
const textFails = textRows
  .filter((t) => !t.pass)
  .filter((t) => {
    const k = t.selector + '|' + t.colorRaw + '|' + t.ratio;
    if (seenText.has(k)) return false;
    seenText.add(k);
    return true;
  })
  .sort((a, b) => a.ratio - b.ratio);

/* ---------- 2. 字号清单 ---------- */
/** 从 HTML 片段里取某个 class 的首个文本样本 */
const htmlNoCode = src
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '');
function sampleTextFor(selector) {
  const classes = [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]);
  if (!classes.length) return '';
  const cls = classes[classes.length - 1];
  const re = new RegExp('class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>([^<]{1,40})', 'i');
  const m = htmlNoCode.match(re);
  return m ? m[1].trim() : '';
}
const hasCJK = (s) => /[\u4e00-\u9fa5]/.test(s);

const fontRows = [];
for (const r of rules) {
  if (!r.decls['font-size']) continue;
  const raw = resolveVars(r.decls['font-size']);
  const m = raw.match(/([\d.]+)px/);
  if (!m) continue;
  const px = parseFloat(m[1]);
  if (px >= 12) continue;
  const sample = sampleTextFor(r.selector);
  // 中文界面为默认假设：取不到样本时按中文判（更严格）；样本是纯数字/罗马数字才按数字判
  const chinese = sample ? hasCJK(sample) : true;
  const need = chinese ? 12 : 11;
  fontRows.push({ selector: r.selector, line: r.line, px, sample, chinese, need, pass: px >= need });
}
const fontFails = fontRows
  .filter((f) => !f.pass)
  .filter((f, i, arr) => arr.findIndex((x) => x.selector === f.selector && x.px === f.px) === i)
  .sort((a, b) => a.px - b.px);

/* Canvas 字号 */
const canvasFonts = [];
const fontRe = /\.font\s*=\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
let fm;
while ((fm = fontRe.exec(src)) !== null) {
  const str = fm[2];
  const pxm = str.match(/([\d.]+)px/);
  if (!pxm) continue;
  const px = parseFloat(pxm[1]);
  if (px >= 12) continue;
  canvasFonts.push({ line: lineAt(fm.index), px, font: str });
}

/* ---------- 3. 色盲模拟 ---------- */
const M_RGB2LMS = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922]
];
const M_LMS2RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789]
];
const CVD = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  deutan: [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
  tritan: [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]]
};
const mul = (M, v) => M.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const srgb2lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const lin2srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
/** 对颜色做指定类型的色盲模拟，返回 sRGB 0-255 */
function simulate(c, type) {
  const rgb = [c.r / 255, c.g / 255, c.b / 255].map(srgb2lin);
  const lms = mul(M_RGB2LMS, rgb);
  const lms2 = mul(CVD[type], lms);
  const out = mul(M_LMS2RGB, lms2).map((v) => Math.min(1, Math.max(0, v)));
  return out.map((v) => Math.min(255, Math.max(0, lin2srgb(v) * 255)));
}
/** sRGB → CIELAB */
function toLab(c) {
  const [r, g, b] = [c.r / 255, c.g / 255, c.b / 255].map(srgb2lin);
  const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const Y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const Z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X); const fy = f(Y); const fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
/** CIEDE2000 */
function deltaE00(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp1 = (Cp1 === 0) ? 0 : ((Math.atan2(b1, ap1) / rad) + 360) % 360;
  const hp2 = (Cp2 === 0) ? 0 : ((Math.atan2(b2, ap2) / rad) + 360) % 360;
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hb = (hp1 + hp2) / 2;
  if (Cp1 * Cp2 !== 0 && Math.abs(hp1 - hp2) > 180) hb += (hp1 + hp2 < 360 ? 180 : -180);
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad)
    + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hb - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cpb, 7) / (Math.pow(Cpb, 7) + Math.pow(25, 7)));
  const Lt = 1 + (0.015 * Math.pow(Lb - 50, 2)) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
  const Ct = 1 + 0.045 * Cpb;
  const Ht = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  const x = dL / Lt;
  const y = dC / Ct;
  const z = dH / Ht;
  return Math.sqrt(x * x + y * y + z * z + Rt * y * z);
}
const dE = (c1, c2, type) => deltaE00(toLab({ r: simulate(c1, type)[0], g: simulate(c1, type)[1], b: simulate(c1, type)[2] }), toLab({ r: simulate(c2, type)[0], g: simulate(c2, type)[1], b: simulate(c2, type)[2] }));

/* 语义色（从文件常量读取，缺省用文件同值兜底） */
const SEM = {
  '敌人血条': parseColor('#ff6b7f'),
  '危险预警环': parseColor('rgba(255,90,110,1)'),
  '玩家血条起': parseColor('#ff8a6b'),
  '玩家血条终(拾取金)': parseColor(V('--gold', '#ffc247')),
  '奥能球(青)': parseColor(V('--tech', '#3ee6ff')),
  '治疗(绿)': parseColor(V('--good', '#47e8a7')),
  '警告橙': parseColor(V('--warn', '#ffb84d')),
  '精英环(暖金)': parseColor('rgba(255,214,150,1)'),
  '精英环外(橙红)': parseColor('rgba(255,120,90,1)'),
  '魔法紫': parseColor(V('--magic', '#b085ff')),
  '稀有蓝': parseColor(V('--rar-rare', '#4aa8ff')),
  '史诗紫': parseColor(V('--rar-epic', '#b47cff')),
  '普通灰': parseColor(V('--rar-common', '#9fb0c8')),
  '冰霜': parseColor('#7fd8ff'),
  '雷电': parseColor('#8fe4ff'),
  '连锁绿': parseColor('#9cff5e'),
  '控制紫': parseColor('#8f7bff'),
  '灼烧橙': parseColor('#ff9a5a'),
  '淬毒绿': parseColor('#b6ff6b')
};
const CVD_PAIRS = [
  ['敌人血条', '玩家血条起'],
  ['敌人血条', '玩家血条终(拾取金)'],
  ['敌人血条', '奥能球(青)'],
  ['危险预警环', '玩家血条终(拾取金)'],
  ['危险预警环', '奥能球(青)'],
  ['危险预警环', '治疗(绿)'],
  ['精英环(暖金)', '敌人血条'],
  ['精英环(暖金)', '危险预警环'],
  ['精英环(暖金)', '玩家血条终(拾取金)'],
  ['玩家血条起', '玩家血条终(拾取金)'],
  ['警告橙', '玩家血条终(拾取金)'],
  ['稀有蓝', '史诗紫'],
  ['普通灰', '稀有蓝'],
  ['冰霜', '雷电'],
  ['冰霜', '奥能球(青)'],
  ['连锁绿', '治疗(绿)'],
  ['控制紫', '史诗紫'],
  ['灼烧橙', '玩家血条终(拾取金)'],
  ['淬毒绿', '治疗(绿)']
];

/* 语义色在游戏地面上的图形对比度（3:1 门槛） */
const FLOOR = parseColor('#12233a');
const graphicRows = Object.entries(SEM).map(([name, c]) => ({
  name,
  color: hex(c),
  onFloor: Number(contrast(c, FLOOR).toFixed(2)),
  onDark: Number(contrast(c, parseColor('#0a1524')).toFixed(2))
}));

/* ---------- 4. 动效 / 闪烁 ---------- */
const animRows = [];
for (const r of rules) {
  const anim = r.decls.animation || r.decls['animation-name'];
  if (!anim) continue;
  if (!/infinite/i.test(r.decls.animation || '')) continue;
  const dm = (r.decls['animation-duration'] || anim).match(/([\d.]+)s/);
  if (!dm) continue;
  const dur = parseFloat(dm[1]);
  animRows.push({ selector: r.selector, line: r.line, duration: dur, hz: Number((1 / dur).toFixed(2)), decl: anim });
}
/* JS 内高频闪烁 / 抖动：Math.sin(t * k) 中 k/(2π) > 3Hz */
const jsHighFreq = [];
const jsRe = /Math\.(sin|cos)\(t\s*\*\s*([\d.]+)/g;
let jm;
while ((jm = jsRe.exec(src)) !== null) {
  const k = parseFloat(jm[2]);
  const hz = k / (2 * Math.PI);
  if (hz > 3) jsHighFreq.push({ line: lineAt(jm.index), hz: Number(hz.toFixed(2)), expr: jm[0] });
}

/* ---------- 输出 ---------- */
const out = {
  file: FILE,
  bytes: buf.length,
  chars: src.length,
  lines: lineStarts.length,
  md5: MD5,
  cssRules: rules.length,
  textRules: textRows.length,
  textFails,
  fontCssFails: fontFails,
  fontCanvas: canvasFonts,
  fontCssCount: fontRows.length,
  cvd: CVD_PAIRS.filter(([a, b]) => {
    if (!SEM[a] || !SEM[b]) { console.error('CVD 缺少颜色键:', a, b); return false; }
    return true;
  }).map(([a, b]) => ({
    a, b,
    normal: Number(dE(SEM[a], SEM[b], 'normal').toFixed(1)),
    protan: Number(dE(SEM[a], SEM[b], 'protan').toFixed(1)),
    deutan: Number(dE(SEM[a], SEM[b], 'deutan').toFixed(1)),
    tritan: Number(dE(SEM[a], SEM[b], 'tritan').toFixed(1))
  })),
  graphics: graphicRows,
  anims: animRows.sort((x, y) => y.hz - x.hz),
  jsHighFreq
};
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'a11y_measure_out.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

/* ---------- 生成 Markdown 数据表（供报告直接引用） ---------- */
const md = [];
md.push('# 无障碍量化数据表（自动生成，勿手改）\n');
md.push(`快照：${out.bytes} B / ${out.chars} 字符 / ${out.lines} 行 / MD5 ${out.md5}\n`);
md.push('## A. 文字对比度不达标全表\n');
md.push('| 实测 | 门槛 | 位置（行） | 选择器 | 前景色（已合成） | 字号 | 判定底色 |');
md.push('|---|---|---|---|---|---|---|');
for (const t of textFails) {
  md.push(`| **${t.ratio}:1** | ${t.need}:1 | L${t.line} | \`${t.selector}\` | ${t.color} (α${t.alpha.toFixed(2)}) | ${t.fontSize ?? '继承'} | ${t.backdrop} |`);
}
md.push(`\n合计 **${textFails.length}** 条（检查了 ${out.textRules} 个含 color 的规则，其余 ${out.textRules - textFails.length} 条达标）。\n`);

md.push('## B. 字号低于线全表（CSS）\n');
const groups = new Map();
for (const f of fontFails) {
  if (!groups.has(f.px)) groups.set(f.px, []);
  groups.get(f.px).push(f);
}
md.push('| 字号 | 门槛 | 条数 | 位置（行）与选择器 |');
md.push('|---|---|---|---|');
for (const px of [...groups.keys()].sort((a, b) => a - b)) {
  const arr = groups.get(px);
  md.push(`| ${px}px | ${arr[0].need}px | ${arr.length} | ${arr.map((f) => `L${f.line} \`${f.selector}\``).join('<br>')} |`);
}
md.push(`\n合计 **${fontFails.length}** 条低于线（共检查 ${fontRows.length} 条 <12px 声明）。\n`);

md.push('## C. Canvas 字号\n');
md.push('| 字号 | 行 | 字体串 |');
md.push('|---|---|---|');
for (const f of canvasFonts) md.push(`| ${f.px}px | L${f.line} | \`${f.font}\` |`);
md.push('');

md.push('## D. 色盲三型 ΔE00（CIEDE2000，sRGB 线性空间模拟）\n');
md.push('| 语义对 | 正常 | 红色盲 P | 绿色盲 D | 蓝色盲 T | 判定（最差） |');
md.push('|---|---|---|---|---|---|');
for (const c of out.cvd) {
  const worst = Math.min(c.protan, c.deutan, c.tritan);
  const verdict = worst < 6 ? '不可分' : worst < 10 ? '边缘' : '可分';
  md.push(`| ${c.a} vs ${c.b} | ${c.normal} | ${c.protan} | ${c.deutan} | ${c.tritan} | ${verdict} |`);
}
md.push('');

md.push('## E. 语义色在画布地面上的对比度（图形门槛 3:1）\n');
md.push('| 语义 | 颜色 | 地面 #12233A | 暗地面 #0A1524 | 判定 |');
md.push('|---|---|---|---|---|');
for (const g of graphicRows) md.push(`| ${g.name} | ${g.color} | ${g.onFloor}:1 | ${g.onDark}:1 | ${g.onFloor >= 3 ? '达标' : '不达标'} |`);
md.push('');

md.push('## F. 循环动画与高频闪烁\n');
md.push('| 频率 | 行 | 选择器 | 声明 |');
md.push('|---|---|---|---|');
for (const a of out.anims) md.push(`| ${a.hz}Hz | L${a.line} | \`${a.selector}\` | ${a.decl} |`);
md.push('\nJS 侧 >3Hz 振荡：\n');
md.push('| 频率 | 行 | 表达式 |');
md.push('|---|---|---|');
for (const j of jsHighFreq) md.push(`| ${j.hz}Hz | L${j.line} | \`${j.expr}…\` |`);

const mdPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'a11y_tables.md');
fs.writeFileSync(mdPath, md.join('\n') + '\n', 'utf8');

/* 控制台摘要 */
console.log('=== 文件快照 ===');
console.log(`bytes=${out.bytes} chars=${out.chars} lines=${out.lines} md5=${out.md5}`);
console.log(`CSS 规则=${out.cssRules} 含 color 的规则=${out.textRules}`);
console.log('\n=== 对比度不达标（最低 20 条）===');
for (const t of textFails.slice(0, 20)) {
  console.log(`${t.ratio}:1 (需${t.need}) L${t.line} ${t.selector} color=${t.colorRaw} fs=${t.fontSize ?? '-'} bg=${t.backdrop}`);
}
console.log(`对比度不达标合计: ${textFails.length}`);
console.log('\n=== 字号低于线（CSS，最低 25 条）===');
for (const f of fontFails.slice(0, 25)) {
  console.log(`${f.px}px (需${f.need}) L${f.line} ${f.selector} sample="${f.sample}"`);
}
console.log(`CSS 字号不达标合计: ${fontFails.length} / 检查 ${fontRows.length}`);
console.log('\n=== Canvas 字号 < 12px ===');
for (const f of canvasFonts) console.log(`${f.px}px L${f.line} ${f.font}`);
console.log(`合计 ${canvasFonts.length}`);
console.log('\n=== 色盲 ΔE00 ===');
for (const c of out.cvd) console.log(`${c.a} vs ${c.b}: 正常=${c.normal} P=${c.protan} D=${c.deutan} T=${c.tritan}`);
console.log('\n=== 语义色在地面上的对比度 ===');
for (const g of graphicRows) console.log(`${g.name} ${g.color}: floor=${g.onFloor} dark=${g.onDark}`);
console.log('\n=== 循环动画频率 ===');
for (const a of animRows) console.log(`${a.hz}Hz L${a.line} ${a.selector} ${a.decl}`);
console.log('\n=== JS 高频（>3Hz）===');
for (const j of jsHighFreq) console.log(`${j.hz}Hz L${j.line} ${j.expr}`);
console.log(`\nJSON: ${outPath}`);
