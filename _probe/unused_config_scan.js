/**
 * "声明了但没人用"的配置扫描（只读）
 * ------------------------------------------------------------------
 * 背景：PLAYER_ART_CONFIG.outlineWidth 曾经只在对象字面量里声明，
 * 全文件没有任何绘制代码引用它，改它画面纹丝不动。
 * 这里用文本静态扫描找出同类：
 *   1) 顶层 `const XXX = { ... };` 配置对象（列 0 缩进）
 *   2) 对象里 2 空格缩进的键
 *   3) 统计每个键在文件中"作为成员访问"（.key）与"整词出现"的次数
 * 判定：
 *   - 成员访问 0 次、整词出现 1 次（只在声明处）→ 确认未使用
 *   - 成员访问 0 次、整词出现 >1 次 → 可能被解构/同名字段撞车，列为"需人工确认"
 *   - 配置名整词出现 1 次 → 整个配置没有被引用
 * 注意：只做文本统计，不执行代码；不修改任何文件。
 * 用法：node _probe/unused_config_scan.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

/** 转义正则元字符 */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 统计字符串在源码中的出现次数（整词） */
function countWord(name) {
  const re = new RegExp('\\b' + esc(name) + '\\b', 'g');
  return (src.match(re) || []).length;
}

/** 统计 `.name` 形式的成员访问次数 */
function countMember(name) {
  const re = new RegExp('\\.' + esc(name) + '\\b', 'g');
  return (src.match(re) || []).length;
}

/** 找出顶层配置对象：`const XXX = {` 起始、`};` 结束 */
function findConfigBlocks() {
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^const ([A-Z][A-Z0-9_]*)\s*=\s*\{\s*$/.exec(lines[i]);
    if (!m) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\};\s*$/.test(lines[j])) { end = j; break; }
    }
    if (end > i) blocks.push({ name: m[1], start: i + 1, end: end + 1 });
  }
  return blocks;
}

/** 取对象第一层键（2 空格缩进） */
function topKeys(block) {
  const keys = [];
  for (let i = block.start; i < block.end - 1; i += 1) {
    const m = /^ {2}([A-Za-z_$][\w$]*)\s*:/.exec(lines[i]);
    if (m) keys.push({ key: m[1], line: i + 1 });
  }
  return keys;
}

const blocks = findConfigBlocks();
const unused = [];
const suspect = [];
const unusedBlocks = [];

blocks.forEach((b) => {
  const nameCount = countWord(b.name);
  if (nameCount <= 1) { unusedBlocks.push({ name: b.name, line: b.start, count: 0 }); return; }
  topKeys(b).forEach((k) => {
    const member = countMember(k.key);
    const word = countWord(k.key);
    if (member === 0 && word <= 1) unused.push({ block: b.name, key: k.key, line: k.line });
    else if (member === 0) suspect.push({ block: b.name, key: k.key, line: k.line, wordCount: word });
  });
});

console.log('顶层配置对象: ' + blocks.length + ' 个');
console.log('\n=== 整个配置从未被引用 ===');
if (!unusedBlocks.length) console.log('（无）');
unusedBlocks.forEach((x) => console.log(`  ${x.name}  (声明 L${x.line})`));

console.log('\n=== 确认未使用的键（成员访问 0 次、整词仅声明 1 次）===');
if (!unused.length) console.log('（无）');
unused.forEach((x) => console.log(`  ${x.block}.${x.key}  (声明 L${x.line})`));

console.log('\n=== 需人工确认（成员访问 0 次，但整词在别处出现，可能同名/解构）===');
if (!suspect.length) console.log('（无）');
suspect.forEach((x) => console.log(`  ${x.block}.${x.key}  (声明 L${x.line}，整词出现 ${x.wordCount} 次)`));

fs.writeFileSync(path.join(__dirname, '..', 'shots', 'audit', 'unused-config-scan.json'),
  JSON.stringify({ blocks: blocks.length, unused, suspect, unusedBlocks }, null, 2));
