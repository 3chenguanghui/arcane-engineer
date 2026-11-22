/**
 * 从工作副本中切出注入块，生成可粘贴补丁文件
 * ------------------------------------------------------------
 * 输入：mobile/index_arcane_v2_mobile.html（只读）
 * 输出：mobile/patch/arcm-mobile.css、arcm-mobile.js
 * 说明：切片按行号原样复制，不重排、不格式化，保证与验收过的副本逐字节一致。
 * 用法：node mobile/tools/_mkpatch.js
 */
const fs = require('fs');
const path = require('path');

const MOBILE_DIR = path.join(__dirname, '..');
const SRC = path.join(MOBILE_DIR, 'index_arcane_v2_mobile.html');
const OUT = path.join(MOBILE_DIR, 'patch');

/** 取 1 基行号区间（含首尾）的文本 */
function slice(lines, from, to) {
  return lines.slice(from - 1, to).join('\n');
}

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
fs.mkdirSync(OUT, { recursive: true });

/* 校验边界，防止行号漂移后切错 */
const checks = [
  [72355, /<style id="arcm-style">/],
  [72817, /^<\/style>$/],
  [72819, /<div id="arcmShade"/],
  [72826, /<div id="arcmGoal"/],
  [72828, /^<script>$/],
  [73266, /^<\/script>$/]
];
checks.forEach(([ln, re]) => {
  const ok = re.test((lines[ln - 1] || '').trim());
  if (!ok) throw new Error(`边界校验失败：第 ${ln} 行不等于 ${re}`);
});

const cssHeader = `/* ============================================================
   烬 · 手机横屏触控层 —— 样式（arcm-mobile.css）
   ------------------------------------------------------------
   来源：工作副本 mobile/index_arcane_v2_mobile.html
        第 72356–72816 行（<style id="arcm-style"> 内部，逐字节复制）
   贴法：在主文件 </body> 之前新建
        <style id="arcm-style">
          ……本文件全部内容……
        </style>
   注意：本文件只有 CSS，不含 <style> 标签本身。
   ============================================================ */
`;

const jsHeader = `/* ============================================================
   烬 · 手机横屏触控层 —— 脚本（arcm-mobile.js）
   ------------------------------------------------------------
   来源：工作副本 mobile/index_arcane_v2_mobile.html
        第 72829–73265 行（<script> 内部，逐字节复制）
   贴法：紧跟在 <style id="arcm-style">…</style> 和触控层 DOM 之后，
        用 <script> ……本文件全部内容…… </script> 包起来，放在 </body> 之前。
   依赖：需要同目录 合并说明.md 里给出的 5 个 DOM 节点先存在。
   ============================================================ */
`;

const css = cssHeader + slice(lines, 72356, 72816) + '\n';
const js = jsHeader + slice(lines, 72829, 73265) + '\n';

fs.writeFileSync(path.join(OUT, 'arcm-mobile.css'), css, 'utf8');
fs.writeFileSync(path.join(OUT, 'arcm-mobile.js'), js, 'utf8');

console.log('arcm-mobile.css', Buffer.byteLength(css), 'B', css.split('\n').length, '行');
console.log('arcm-mobile.js ', Buffer.byteLength(js), 'B', js.split('\n').length, '行');
