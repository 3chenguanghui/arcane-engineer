/**
 * ui_static.js —— UI 基线自检的静态扫描（只读主文件，不写任何产物到主文件）
 *
 * 目的：从 index_arcane_v2.html 的 <style> 块中统计
 *   1) 字号档位（声明值、去重后的档数）
 *   2) 硬编码颜色（hex / rgb / rgba / hsl）不同值个数
 *   3) padding / margin / gap 里不是 4 的倍数的值（间距欠账）
 *   4) outline:none 出现位置
 *   5) tabular-nums（等宽数字）出现次数
 * 用法：node ui_static.js [主文件路径]
 */
const fs = require('fs');

/** 读取文件并把所有 <style> 块拼成一个大字符串 */
function readCss(file) {
  const html = fs.readFileSync(file, 'utf8');
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  return { html, css: blocks.join('\n'), blockCount: blocks.length };
}

/** 把 #abc / #aabbcc / #aabbccdd 统一成 6 位大写（带 alpha 的单独标注） */
function normHex(h) {
  const s = h.slice(1);
  if (s.length === 3) return '#' + s.split('').map(c => c + c).join('').toUpperCase();
  if (s.length === 6) return '#' + s.toUpperCase();
  if (s.length === 8) return '#' + s.slice(0, 6).toUpperCase() + '/' + s.slice(6).toUpperCase();
  if (s.length === 4) return '#' + s.slice(0, 3).split('').map(c => c + c).join('').toUpperCase() + '/' + s[3] + s[3];
  return h.toUpperCase();
}

/** 主流程：统计并打印结果 */
function main() {
  const file = process.argv[2] || 'D:\\其他\\TRAE宝\\奥术工程师\\index_arcane_v2.html';
  const { html, css, blockCount } = readCss(file);

  // ---------- 1) 字号 ----------
  const fsDecls = [...css.matchAll(/font-size\s*:\s*([^;}]+)/gi)].map(m => m[1].trim().toLowerCase());
  const fsCount = new Map();
  fsDecls.forEach(v => fsCount.set(v, (fsCount.get(v) || 0) + 1));
  console.log('=== 1. 字号（<style> 内声明） ===');
  console.log('style 块数=' + blockCount + '  font-size 声明数=' + fsDecls.length);
  [...fsCount.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .forEach(([v, n]) => console.log('  ' + v.padEnd(14) + ' x' + n));

  // ---------- 2) 颜色 ----------
  const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => normHex(m[0]));
  const rgbs = [...css.matchAll(/rgba?\([^)]*\)/gi)].map(m => m[0].replace(/\s+/g, '').toLowerCase());
  const hsls = [...css.matchAll(/hsla?\([^)]*\)/gi)].map(m => m[0].replace(/\s+/g, '').toLowerCase());
  const colors = new Set([...hexes, ...rgbs, ...hsls]);
  console.log('\n=== 2. 硬编码颜色 ===');
  console.log('hex 出现=' + hexes.length + '  去重=' + new Set(hexes).size);
  console.log('rgb/rgba 出现=' + rgbs.length + '  去重=' + new Set(rgbs).size);
  console.log('hsl 出现=' + hsls.length + '  去重=' + new Set(hsls).size);
  console.log('合计不同色值=' + colors.size);
  const top = [...new Set([...hexes, ...rgbs, ...hsls])];
  const freq = new Map();
  [...hexes, ...rgbs, ...hsls].forEach(c => freq.set(c, (freq.get(c) || 0) + 1));
  top.sort((a, b) => freq.get(b) - freq.get(a)).slice(0, 25)
    .forEach(c => console.log('  ' + String(freq.get(c)).padStart(3) + '  ' + c));

  // ---------- 3) 间距 ----------
  const spacingDecls = [...css.matchAll(/(?:^|[;{\s])(padding|margin|gap|row-gap|column-gap)\s*:\s*([^;}]+)/gi)]
    .map(m => ({ prop: m[1].toLowerCase(), val: m[2].trim() }));
  const bad = [];
  const pxValues = new Set();
  spacingDecls.forEach(({ prop, val }) => {
    [...val.matchAll(/(-?\d*\.?\d+)px/g)].forEach(m => {
      const n = parseFloat(m[1]);
      pxValues.add(n);
      if (n % 4 !== 0) bad.push(prop + ':' + val);
    });
  });
  console.log('\n=== 3. 间距 ===');
  console.log('padding/margin/gap 声明数=' + spacingDecls.length + '  用到的 px 值=' + pxValues.size);
  console.log('含非 4 倍数 px 的声明数=' + bad.length);
  const badUnique = [...new Set(bad)];
  badUnique.slice(0, 30).forEach(b => console.log('  ! ' + b));
  const non4 = [...pxValues].filter(n => n % 4 !== 0).sort((a, b) => a - b);
  console.log('非 4 倍数的 px 值(' + non4.length + ')：' + non4.join(', '));

  // ---------- 4) outline ----------
  const outlines = [...css.matchAll(/outline\s*:\s*([^;}]+)/gi)].map(m => m[1].trim());
  console.log('\n=== 4. outline ===');
  console.log('outline 声明数=' + outlines.length);
  const oc = new Map();
  outlines.forEach(v => oc.set(v, (oc.get(v) || 0) + 1));
  [...oc.entries()].forEach(([v, n]) => console.log('  ' + v + '  x' + n));

  // ---------- 5) 等宽数字 ----------
  console.log('\n=== 5. 等宽数字 ===');
  console.log('tabular-nums 出现=' + (css.match(/tabular-nums/g) || []).length);
  console.log('font-variant-numeric 声明=' + (css.match(/font-variant-numeric/g) || []).length);
  console.log('全文件 tabular-nums 出现=' + (html.match(/tabular-nums/g) || []).length);
}

main();
