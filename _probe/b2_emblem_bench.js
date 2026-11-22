/**
 * B2 卡面纹样基准（只读主文件，不写任何主文件）
 * ------------------------------------------------------------
 * 1) 从 index_arcane_v2.html 里原样抽出 cardFieldSvg() 源码并 eval（保证测的就是线上代码）
 * 2) 从 MAGIC_CONFIG / TECH_CONFIG / RELIC_CONFIG / FUSION_CONFIG 抽出全部卡 id
 * 3) 报：卡总数、纹样去重后数量、单卡生成耗时（1000 次均值）、SVG 平均字节
 * 用法：node _probe/b2_emblem_bench.js
 */
const fs = require('fs');
const path = require('path');

const MAIN = process.env.ARCANE_MAIN
  ? path.resolve(process.env.ARCANE_MAIN)
  : path.join(__dirname, '..', 'index_arcane_v2.html');
const src = fs.readFileSync(MAIN, 'utf8');

/** 抽出指定函数的完整源码（按 "function name(" 起，按行首 "}" 收） */
function extractFn(text, name) {
  const start = text.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函数 ' + name);
  let i = text.indexOf('{', start);
  let depth = 0;
  for (; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('函数未闭合 ' + name);
}

/** 抽出数组块里所有 id: 'xxx' */
function idsOf(text, constName) {
  const start = text.indexOf('const ' + constName);
  if (start < 0) return [];
  const end = text.indexOf('\n];', start);
  const block = text.slice(start, end < 0 ? start + 20000 : end);
  const ids = [];
  const re = /\bid:\s*'([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(block))) ids.push(m[1]);
  return Array.from(new Set(ids));
}

const fnSrc = extractFn(src, 'cardFieldSvg');
/* eslint-disable no-eval */
const cardFieldSvg = eval('(' + fnSrc + ')');

const groups = [
  ['magic', idsOf(src, 'MAGIC_CONFIG')],
  ['tech', idsOf(src, 'TECH_CONFIG')],
  ['relic', idsOf(src, 'RELIC_CONFIG')],
  ['fusion', idsOf(src, 'FUSION_CONFIG')]
];

const all = [];
groups.forEach((g) => g[1].forEach((id) => all.push({ kind: g[0], id, key: g[0] + ':' + id })));
/* 契约 / 补给是固定卡，手工补两条进来一起测 */
all.push({ kind: 'pact', id: 'overclock', key: 'pact:overclock' });
all.push({ kind: 'supply', id: 'supply', key: 'supply:supply' });

const sigs = new Set();
let bytes = 0;
all.forEach((o) => {
  const html = cardFieldSvg(o);
  bytes += Buffer.byteLength(html, 'utf8');
  sigs.add(html);
});

const N = 1000;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i += 1) cardFieldSvg(all[i % all.length]);
const t1 = process.hrtime.bigint();
const perCardMs = Number(t1 - t0) / 1e6 / N;

console.log(JSON.stringify({
  source: path.basename(MAIN),
  cards: all.length,
  byKind: groups.map((g) => g[0] + ':' + g[1].length).join(' '),
  distinctEmblems: sigs.size,
  avgSvgBytes: +(bytes / all.length).toFixed(1),
  perCardMs: +perCardMs.toFixed(4),
  msForFourCards: +(perCardMs * 4).toFixed(3)
}, null, 2));
