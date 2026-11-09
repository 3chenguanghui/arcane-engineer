/**
 * 把触屏层与两个文案补丁内联进主文件副本，生成 touch-demo.html
 * ------------------------------------------------------------
 * 只读取 index_arcane_v2.html，不修改它；输出文件 = 主文件 + 三段内联脚本。
 * 注入顺序固定：touch.js → patch-touch-keycaps.js → patch-touch-copy.js
 * （补丁依赖触屏层已挂好，且键帽补丁先于文案补丁执行）。
 * 用法：node tools/_touch_demo_build.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'touch-demo.html');

/* 每个脚本的 id 与文件路径（顺序即执行顺序） */
const BLOCKS = [
  { id: 'tg-touch-inline', file: 'touch.js' },
  { id: 'tg-keycaps-inline', file: 'patch-touch-keycaps.js' },
  { id: 'tg-copy-inline', file: 'patch-touch-copy.js' }
];

const html = fs.readFileSync(SRC, 'utf8');
if (html.lastIndexOf('</body>') < 0) throw new Error('主文件缺少 </body>，无法注入');

/* 三个源文件的注释都已避免出现完整结束标签，因此可直接内联 */
const tags = BLOCKS.map((block) => {
  const js = fs.readFileSync(path.join(ROOT, block.file), 'utf8');
  return '<script id="' + block.id + '">\n' + js + '\n</script>';
}).join('\n');

const at = html.lastIndexOf('</body>');
const out = html.slice(0, at) + tags + '\n' + html.slice(at);
fs.writeFileSync(OUT, out, 'utf8');
console.log('WROTE ' + OUT + ' · ' + out.length + ' bytes · ' + BLOCKS.length + ' inline blocks');
