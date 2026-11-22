/**
 * 重建"③ 改前"快照（用于回退）
 * ------------------------------------------------------------
 * 做法：从当前文件里精确移除 ③ 新增的调用与函数块，写出到 baseline，
 * 然后比对 MD5 是否等于改前记录的 8A33D4B23B4729A04101478AB097AB4C。
 * 若不一致则报错退出，不留下不可信的快照。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const DST = path.join(ROOT, 'baseline', 'index_arcane_v2.P0-topstack.before.html');
const EXPECT = '8A33D4B23B4729A04101478AB097AB4C';

let s = fs.readFileSync(SRC, 'utf8');
/** 精确删除一段字符串，找不到就抛错（避免静默产生错误快照） */
function cut(from, to = '') {
  if (!s.includes(from)) throw new Error('未找到片段：' + from.slice(0, 60));
  s = s.replace(from, to);
}

// 1) toastShowOne 内部两处调用
cut(`  ui.toast.className = 'toast is-on' + (type ? ' is-' + type : '');\n  layoutTopStack();\n`,
  `  ui.toast.className = 'toast is-on' + (type ? ' is-' + type : '');\n`);
cut(`    ui.toast.className = 'toast';\n    toastBusyUntil = 0;\n    layoutTopStack();\n`,
  `    ui.toast.className = 'toast';\n    toastBusyUntil = 0;\n`);

// 2) 整个布局函数块（含常量、resize 监听）
const blockStart = s.indexOf('/* P0 ③ 顶部三行字防重叠：');
const blockEndMark = `window.addEventListener('resize', () => layoutTopStack());\n`;
const blockEnd = s.indexOf(blockEndMark, blockStart);
if (blockStart < 0 || blockEnd < 0) throw new Error('未找到布局函数块');
s = s.slice(0, blockStart) + s.slice(blockEnd + blockEndMark.length);
// 删除后残留一行多余空行（插入时它属于新块），收回到原来的两行间隔
s = s.replace(`}\n\n\n/**\n * F 批 · 演出分级`, `}\n\n/**\n * F 批 · 演出分级`);

// 3) tutorialRender / tutorialShow
cut(`  // 换步后文案长度变了，卡片高度可能变，重排一次顶部堆叠\n  layoutTopStack();\n`, '');
cut(`  refs.overlay.classList.toggle('is-hidden', !on);\n  layoutTopStack();\n`,
  `  refs.overlay.classList.toggle('is-hidden', !on);\n`);

// 4) spiritTick 三处
cut(`    if (ui.spiritLine) ui.spiritLine.classList.remove('is-on');\n    layoutTopStack();\n`,
  `    if (ui.spiritLine) ui.spiritLine.classList.remove('is-on');\n`);
cut(`      if (ui.spiritLine) ui.spiritLine.classList.remove('is-on');\n      layoutTopStack();\n`,
  `      if (ui.spiritLine) ui.spiritLine.classList.remove('is-on');\n`);
cut(`    ui.spiritLine.classList.add('is-on');\n    // 叙事句高度随文案变化，出现后立刻参与顶部堆叠（避免压住训练条）\n    layoutTopStack();\n`,
  `    ui.spiritLine.classList.add('is-on');\n`);

// 5) onboardRenderHint
cut(`  if (ui.spiritLine) ui.spiritLine.classList.remove('is-on');\n  layoutTopStack();\n  const seen = loadOnboardSeen();\n`,
  `  if (ui.spiritLine) ui.spiritLine.classList.remove('is-on');\n  const seen = loadOnboardSeen();\n`);

// 6) showIntroHint / hideIntroHint
cut(`  ui.introHint.setAttribute('aria-hidden', 'false');\n  layoutTopStack();\n`,
  `  ui.introHint.setAttribute('aria-hidden', 'false');\n`);
cut(`    if (ui.introHint) ui.introHint.classList.add('is-hidden');\n    layoutTopStack();\n`,
  `    if (ui.introHint) ui.introHint.classList.add('is-hidden');\n`);
cut(`    ui.introHint.setAttribute('aria-hidden', 'true');\n  }\n  layoutTopStack();\n`,
  `    ui.introHint.setAttribute('aria-hidden', 'true');\n  }\n`);

fs.writeFileSync(DST, s);
const hash = crypto.createHash('md5').update(fs.readFileSync(DST)).digest('hex').toUpperCase();
console.log('快照 MD5 =', hash, hash === EXPECT ? '（与改前一致 ✔）' : '（不一致 ✘）');
if (hash !== EXPECT) process.exit(2);
