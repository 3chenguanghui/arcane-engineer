/**
 * 组装注入块 + 生成实验副本（只写 mobile\，不碰主文件 / delivery）
 * ------------------------------------------------------------
 * 为什么需要它：
 *   1. inject-block.html 是 _build_mobile.js 真正使用的注入体，而补丁源是
 *      patch/arcm-mobile.css 与 patch/arcm-mobile.js。两边手工同步必然漂移，
 *      这里用「头部注释 + CSS + 标记 + JS + 收尾」拼一次，保证单一来源。
 *   2. 主文件正被界面线改（3,242,973 / 81240E8E…，未收尾），不能拿它重建副本。
 *      因此实验副本从**当前只读副本**出发，只替换注入层，游戏逻辑不动。
 *
 * v2 修复（2026-11-11 21:0x）：
 *   旧版用「整块字符串替换」定位，且没检查字面量结束标签。补丁 JS/CSS 的说明注释里
 *   写了 `</script>` / `</style>`，浏览器 HTML 解析器把它们当成真正的结束标签，
 *   注入脚本在第 342 个字符处被截断（SyntaxError: Invalid or unexpected token），
 *   样式同样被截断 → 触摸层 DOM 存在但不可见。
 *   本版改为「按锚点定位 + 分段重建」，并在生成前强制拦截字面量结束标签。
 *
 * 产物：
 *   mobile/patch/inject-block.html            （新注入块）
 *   mobile/lab/index_mobile_touchlab.html     （实验副本）
 *
 * 用法：node mobile/tools/_build_block.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PATCH = path.join(ROOT, 'mobile', 'patch');
const CSS = path.join(PATCH, 'arcm-mobile.css');
const JS = path.join(PATCH, 'arcm-mobile.js');
const BLOCK = path.join(PATCH, 'inject-block.html');
const BASE = path.join(ROOT, 'mobile', 'index_arcane_v2_mobile.html');
const LAB_DIR = path.join(ROOT, 'mobile', 'lab');
const LAB = path.join(LAB_DIR, 'index_mobile_touchlab.html');

const STYLE_OPEN = '<style id="arcm-style">';
const SCRIPT_OPEN = '<script>';

/* 触控层标记区（稳定不变，8 行） */
const MARKUP =
  '<div id="arcmShade" aria-hidden="true"></div>\n' +
  '<div id="arcmStick" role="application" aria-label="移动摇杆">\n' +
  '  <i class="arcm-knob"></i>\n' +
  '  <span class="arcm-stick-label">移动</span>\n' +
  '</div>\n' +
  '<div id="arcmPad" role="group" aria-label="技能按键"></div>\n' +
  '<button type="button" id="arcmDeckBtn" aria-label="打开卡组">卡组</button>\n' +
  '<div id="arcmGoal" role="status" aria-live="polite">清空本层</div>';

/**
 * 统计子串出现次数（自检用）
 * @param {string} hay 被搜文本
 * @param {string} needle 目标子串
 * @returns {number} 次数
 */
function count(hay, needle) {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) return n;
    n += 1;
    i = at + needle.length;
  }
}

/** 致命检查：内联 CSS/JS 正文里绝不能出现字面量的 style/script 结束标签 */
function assertNoRawCloseTag(name, text) {
  if (text.includes('</style')) throw new Error(name + ' 里出现字面量 </style，会截断内联样式');
  if (text.includes('</script')) throw new Error(name + ' 里出现字面量 </script，会截断内联脚本');
}

const oldBlock = fs.readFileSync(BLOCK, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');
const js = fs.readFileSync(JS, 'utf8');
assertNoRawCloseTag('arcm-mobile.css', css);
assertNoRawCloseTag('arcm-mobile.js', js);

/* 头部注释从旧块原样保留（不含 <style> 之前的一切） */
const head = oldBlock.slice(0, oldBlock.indexOf(STYLE_OPEN));
if (!head.trim().endsWith('-->')) throw new Error('注入块头部注释不完整');

const block = head + STYLE_OPEN + '\n' + css + '</style>\n\n' + MARKUP + '\n\n<script>\n' + js + '</script>\n';

/* 自检：关键锚点 */
['<style id="arcm-style">', '<div id="arcmShade"', '<div id="arcmStick"',
  '<div id="arcmPad"', '<button type="button" id="arcmDeckBtn"', '<div id="arcmGoal"',
  "id: 'room'", 'toggleRoomPicker', 'roomPickMuteMouseUntil', '#roomPicker > div']
  .forEach((needle) => {
    if (count(block, needle) < 1) throw new Error('新注入块缺少锚点：' + needle);
  });
if (block.slice(block.indexOf(STYLE_OPEN) + STYLE_OPEN.length + 1).includes('</style>') === false) {
  throw new Error('新注入块样式段未闭合');
}

fs.writeFileSync(BLOCK, block, 'utf8');
console.log('注入块  ', Buffer.byteLength(block), 'B（旧', Buffer.byteLength(oldBlock), 'B，'
  + (Buffer.byteLength(block) - Buffer.byteLength(oldBlock) >= 0 ? '+' : '')
  + (Buffer.byteLength(block) - Buffer.byteLength(oldBlock)) + '）');

/* ================= 实验副本：按锚点分段替换注入层 ================= */
const base = fs.readFileSync(BASE, 'utf8');

const styleOpenAt = base.indexOf(STYLE_OPEN);
if (styleOpenAt < 0) {
  console.log('只读副本里还没有注入块，本轮只更新 inject-block.html；'
    + '先跑 _build_mobile.js，再跑一次本脚本生成实验副本。');
  process.exit(0);
}
const styleBodyAt = base.indexOf('\n', styleOpenAt) + 1;          // 样式正文起点
const styleCloseAt = base.indexOf('</style>', styleBodyAt);       // 样式结束标签
if (styleCloseAt < 0) throw new Error('只读副本注入块样式未闭合');

const goalAt = base.indexOf('<div id="arcmGoal"');
if (goalAt < 0) throw new Error('只读副本里找不到 arcmGoal 标记');
const scriptOpenAt = base.indexOf(SCRIPT_OPEN, goalAt);
if (scriptOpenAt < 0) throw new Error('只读副本里找不到注入脚本起点');
const scriptBodyAt = scriptOpenAt + SCRIPT_OPEN.length + 1;       // 跳过 '<script>\n'
const scriptCloseAt = base.lastIndexOf('</script>');
if (scriptCloseAt < scriptBodyAt) throw new Error('只读副本里找不到注入脚本结束标签');
/* 注入脚本必须是整个文档的最后一个脚本：其后只允许空白与收尾标签 */
const tailAfterScript = base.slice(scriptCloseAt + '</script>'.length);
if (!/^\s*(<\/body>)?\s*(<\/html>)?\s*$/i.test(tailAfterScript)) {
  throw new Error('注入脚本不是文档最后一个脚本，拒绝按位置替换：' + JSON.stringify(tailAfterScript.slice(0, 80)));
}

const lab = base.slice(0, styleBodyAt) + css + '</style>\n\n' + MARKUP + '\n\n<script>\n' + js
  + base.slice(scriptCloseAt);

fs.mkdirSync(LAB_DIR, { recursive: true });
fs.writeFileSync(LAB, lab, 'utf8');

/* 落盘后复检：结构与字节差 */
const labStyleOpen = lab.indexOf(STYLE_OPEN);
const labStyleClose = lab.indexOf('</style>', labStyleOpen);
const labGoal = lab.indexOf('<div id="arcmGoal"');
const labScriptOpen = lab.indexOf(SCRIPT_OPEN, labGoal);
const labScriptClose = lab.indexOf('</script>', labScriptOpen);
const injectLen = labScriptClose - labScriptOpen;
if (labStyleClose < labStyleOpen) throw new Error('实验副本样式未闭合');
if (injectLen < js.length) throw new Error('实验副本注入脚本被截断（' + injectLen + ' < ' + js.length + '）');
if (count(lab, '<div id="arcmPad"') !== 1) throw new Error('实验副本 arcmPad 数量异常');

console.log('实验副本', Buffer.byteLength(lab), 'B →', LAB);
console.log('自检    ', 'ok（样式闭合 / 脚本完整 ' + injectLen + ' 字符 / 标记唯一 / 副本差值 '
  + (Buffer.byteLength(lab) - Buffer.byteLength(base)) + 'B）');
