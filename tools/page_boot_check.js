// 落盘后第一道门禁：先证明页面还能加载，再谈功能断言。
// 用法：node tools/page_boot_check.js [页面路径]
// 判据：页面无 JS 错误 + 关键 DOM/运行时对象存在（按钮 / 画布 / state / __roamDebug）。
// 说明：这是「文件是好的」的最低证明；功能正确性由各专项脚本另行负责。
const path = require('path');
const { openPreview } = require('./preview_cdp');

/**
 * 页面内自检表达式：只读取启动后的状态，不触发游戏逻辑。
 * 直接在页面上下文求值，故可直接引用 document / state / __roamDebug。
 */
const BOOT_EXPR = `({
  readyState: document.readyState,
  title: document.title,
  btnStart: (() => {
    const b = document.getElementById('btnStart');
    return !!b && b.textContent.trim().length > 0;
  })(),
  canvas: (() => {
    const c = document.getElementById('game');
    return !!c && c.width > 0 && c.height > 0;
  })(),
  stateType: typeof state,
  debugType: typeof __roamDebug,
  bodyLen: document.body.innerText.length
})`;

/**
 * 执行启动检查并打印结果。
 * @param {string} page 页面绝对路径
 */
async function main(page) {
  const r = await openPreview(page, BOOT_EXPR, { waitMs: 2600, timeoutMs: 30000 });
  const errors = (r.errors || []).filter((e) => e && !/favicon|net::ERR_FILE/i.test(e));
  const v = r.value || {};
  const ok = errors.length === 0 && v.readyState === 'complete' && v.btnStart && v.canvas
    && v.stateType !== 'undefined' && v.debugType !== 'undefined';
  console.log('BOOT: ' + (ok ? 'PASS' : 'FAIL'));
  console.log('  page      = ' + page);
  console.log('  ready     = ' + v.readyState + ' / title=' + JSON.stringify(v.title || ''));
  console.log('  btnStart  = ' + v.btnStart + ' / canvas=' + v.canvas + ' / bodyLen=' + v.bodyLen);
  console.log('  runtime   = state:' + v.stateType + ' / __roamDebug:' + v.debugType);
  if (errors.length) {
    console.log('  页面错误：');
    errors.slice(0, 6).forEach((e) => console.log('    · ' + e));
  }
  process.exitCode = ok ? 0 : 1;
}

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html'));
main(PAGE).catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
