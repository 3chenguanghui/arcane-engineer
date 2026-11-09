/* 假旋钮三方对账（常驻检查）
 * ------------------------------------------------------------
 * 规则：凡是「配置里有、UI 上有、存档里没有」的开关，都是假旋钮。
 * 假旋钮一律摘掉，不许降级成半可用。
 *
 * 三方：
 *   1) 配置：`const X_CONFIG = { ... }` 里的布尔 / 枚举字段
 *   2) UI  ：`syncA11yToggles()` 实际读取的 state.meta.* 键（有开关就会读）
 *   3) 存档：`defaultMeta()` 的键 + `normalizeMeta()` 的 base.* 白名单
 *
 * 两类判定：
 *   A. UI 读的 meta 键不在存档白名单 → 改了存不下来（必报）
 *   B. 配置字段零引用（嵌套用 `.parent.key` 计数）→ 空壳（确定 / 疑似）
 *
 * 用法：node tools/merge_audit/fake_knob_audit.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = 'D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html';
const txt = fs.readFileSync(SRC, 'utf8');

/** 跳过字符串，返回结束引号下标（含转义） */
function skipString(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j += 1; continue; }
    if (s[j] === q) return j;
  }
  return s.length - 1;
}

/** 从第一个 `{` 起做括号配对，返回 `}` 下标 */
function matchBrace(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(s, i); continue; }
    if (c === '/' && s[i + 1] === '/') { const j = s.indexOf('\n', i); if (j < 0) break; i = j; continue; }
    if (c === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** 取 `const/function NAME ... {` 的整块文本 */
function blockOf(name) {
  const re = new RegExp('(?:const|let|var|function)\\s+' + name + '\\b');
  const m = re.exec(txt);
  if (!m) return '';
  const open = txt.indexOf('{', m.index);
  if (open < 0) return '';
  const close = matchBrace(txt, open);
  return close < 0 ? '' : txt.slice(m.index, close + 1);
}

/** 开关类字段名：只对这类字段做嵌套零引用判定，数据表（id/name/color/glyph）不参与 */
const SWITCHISH = /^(enabled|disabled|mode|level|colorblind|contrast|skippable|auto[A-Z]\w*|reduce[A-Z]\w*|enable[A-Z]\w*|allow[A-Z]\w*|show[A-Z]\w*|hide[A-Z]\w*|use[A-Z]\w*|snapToEightDirs|noContactDamage)$/;

/** 统计出现次数 */
function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n += 1; i += needle.length; }
  return n;
}

/** 收集配置块的顶层键与单行内联嵌套键 */
function configKeys(block) {
  const out = [];
  const lines = block.split('\n');
  for (const line of lines) {
    const m = /^  (\w+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (!/^[A-Za-z_]\w*$/.test(key)) continue;   // 数字键是数组/映射，不是开关
    const val = m[2].replace(/,\s*$/, '').trim();
    if (val === 'true' || val === 'false' || /^'[^']*'$/.test(val)) {
      out.push({ key: key, val: val, parent: null });
    } else if (val.startsWith('{') && val.endsWith('}')) {
      const inner = val.slice(1, -1);
      const parts = inner.split(',');
      for (const part of parts) {
        const mm = /^\s*(\w+):\s*([^,]+)$/.exec(part);
        if (!mm) continue;
        if (!/^[A-Za-z_]\w*$/.test(mm[1])) continue;   // 数字键跳过
        if (mm[2].trim() === 'true' || mm[2].trim() === 'false' || /^'[^']*'$/.test(mm[2].trim())) {
          out.push({ key: mm[1], val: mm[2].trim(), parent: key });
        }
      }
    }
  }
  return out;
}

console.log('=== 假旋钮三方对账 ===');
console.log('主文件：' + txt.split('\n').length + ' 行 / ' + Buffer.byteLength(txt) + ' B\n');

/* ---------- 三方数据 ---------- */

// 存档白名单（defaultMeta 顶层 + 内联嵌套）
const defaultMetaBlock = blockOf('defaultMeta');
const metaKeys = new Set();
{
  const lines = defaultMetaBlock.split('\n');
  for (const line of lines) {
    const m = /^    (\w+):/.exec(line);          // defaultMeta 缩进 4 格
    if (m) metaKeys.add(m[1]);
    const nested = /^\s+(\w+):\s*\{([^}]*)\}/.exec(line);
    if (nested) {
      for (const part of nested[2].split(',')) {
        const mm = /^\s*(\w+):/.exec(part);
        if (mm) metaKeys.add(mm[1]);
      }
    }
  }
}
const normalizeBlock = blockOf('normalizeMeta');
const normalized = new Set([...normalizeBlock.matchAll(/base\.(\w+)\s*=/g)].map((m) => m[1]));

// UI 开关实际读的 meta 键（syncA11yToggles / motionTier 里直接 state.meta.X）
const syncBlock = blockOf('syncA11yToggles');
const motionBlock = blockOf('motionTier');
const uiKeys = new Set([
  ...[...syncBlock.matchAll(/state\.meta\.(\w+)/g)].map((m) => m[1]),
  ...[...syncBlock.matchAll(/READABILITY_CONFIG\.a11y\.(\w+)/g)].map((m) => m[1]),
  ...[...motionBlock.matchAll(/state\.meta\.(\w+)/g)].map((m) => m[1])
]);

console.log('存档白名单：' + metaKeys.size + ' 键（defaultMeta） / ' + normalized.size + ' 键（normalizeMeta 显式写回）');
console.log('UI 开关读取：' + [...uiKeys].join(', ') + '\n');

/* ---------- A. UI → 存档 ---------- */

let aFails = 0;
for (const key of uiKeys) {
  const inDefault = metaKeys.has(key);
  const inNormalize = normalized.has(key);
  if (!inDefault && !inNormalize) {
    aFails += 1;
    console.log('FAIL[A] `state.meta.' + key + '` 有 UI 开关，但 defaultMeta / normalizeMeta 都没有 → 改了存不下来');
  } else if (!inDefault && inNormalize) {
    console.log('WARN[A] `state.meta.' + key + '` 只在 normalizeMeta 写回，defaultMeta 缺默认值（旧档能补，新档要确认）');
  } else if (!inNormalize) {
    console.log('WARN[A] `state.meta.' + key + '` 在 defaultMeta 有默认值，但 normalizeMeta 没做类型收敛（手改存档可能带脏值）');
  } else {
    console.log('PASS[A] `state.meta.' + key + '`：存档白名单已覆盖');
  }
}

/* ---------- B. 配置 → 引用 ---------- */

const configs = [...txt.matchAll(/const\s+(\w+_CONFIG)\s*=\s*\{/g)].map((m) => m[1]);
const definitive = [];
const suspect = [];

for (const name of configs) {
  const block = blockOf(name);
  if (!block) continue;
  const rest = txt.replace(block, '');
  for (const item of configKeys(block)) {
    if (item.parent) {
      // 嵌套：只查开关类字段；父对象直接按名访问，或先赋给局部变量再读 conf.key
      if (!SWITCHISH.test(item.key)) continue;
      const parentUse = count(rest, '.' + item.parent);
      const dotted = count(rest, '.' + item.parent + '.' + item.key);
      const aliasRe = new RegExp('const\\s+(\\w+)\\s*=\\s*(?:' + name + '\\.)?' + item.parent + '\\s*;', 'g');
      let aliasUse = 0;
      for (const m of rest.matchAll(aliasRe)) {
        aliasUse += count(rest, m[1] + '.' + item.key);
      }
      if (parentUse > 0 && dotted === 0 && aliasUse === 0) definitive.push({ name, item });
    } else {
      // 顶层：只报开关类字段；数据文案不参与；同时排除「先赋给局部变量再读」
      if (!SWITCHISH.test(item.key)) continue;
      const qualified = count(rest, name + '.' + item.key);
      const aliasRe = new RegExp('const\\s+(\\w+)\\s*=\\s*' + name + '\\s*;', 'g');
      let aliasUse = 0;
      for (const m of rest.matchAll(aliasRe)) {
        aliasUse += count(rest, m[1] + '.' + item.key);
      }
      const bare = count(rest, item.key);
      if (qualified === 0 && aliasUse === 0 && bare <= 1) suspect.push({ name, item, bare });
    }
  }
}

console.log('\n-- B. 配置字段零引用 --');
console.log('确定零引用（嵌套字段，按 .parent.key 计数）：' + definitive.length + ' 项');
for (const d of definitive) {
  console.log('  FAIL[B] ' + d.name + '.' + d.item.parent + '.' + d.item.key + ' = ' + d.item.val + '（0 次访问）');
}
console.log('疑似零引用（顶层字段，可能经解构读取）：' + suspect.length + ' 项');
for (const s of suspect.slice(0, 12)) {
  console.log('  WARN[B] ' + s.name + '.' + s.item.key + ' = ' + s.item.val + '（限定访问 0 次 / 裸词 ' + s.bare + ' 次）');
}
if (suspect.length > 12) console.log('  ……另有 ' + (suspect.length - 12) + ' 项，未列出');

/* ---------- 汇总 ---------- */

const hard = aFails + definitive.length;
console.log('\n结论：' + (hard === 0 ? 'PASS（无确定空壳）' : 'FAIL（' + hard + ' 项确定空壳：假旋钮 / 死配置，按 §9 分类处理）')
  + '；疑似 ' + suspect.length + ' 项待人工看');
process.exit(hard === 0 ? 0 : 1);
