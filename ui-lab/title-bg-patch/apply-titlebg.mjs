// 把「符阵背景」补丁落到主文件：默认 dry-run 只报预测，--write 才真正写入并回读校验
// 用法：node apply-titlebg.mjs            → 只算不写
//       node apply-titlebg.mjs --write    → 校验贴前 MD5 后写入，并回读校验贴后字节/MD5
//       node apply-titlebg.mjs --write --force → 基线已漂移（B 方案又写过）时允许继续
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const MAIN = 'D:/其他/TRAE宝/奥术工程师/index_arcane_v2.html';
const HERE = 'D:/其他/TRAE宝/奥术工程师/ui-lab/title-bg-patch';
const PAYLOAD = HERE + '/tbg-sigil.payload.js';

// 构建时的基线快照（见 anchors.json）
// 规则：每批成功落地后，负责该批的人必须把 EXPECT_BEFORE 改成落地后的实际 MD5/字节，
//       EXPECT_AFTER 改成「该批再贴一次」的预期值。基线随批次前移，否则下一批必报退出码 3。
// 最近一次前移：2026-11-09，标题层级（T3 间距）落地后（2,868,107 B / B382611E2C0D1C82D9FE2832D374B1BD）
// 基线已随批次前移（2026-11-09 成就 P5 批后）：2,936,339 / A3766F48…
// 本批不改标题背景，EXPECT_BEFORE/EXPECT_AFTER 同钉当前值，表示"符阵背景已在树内"。
const EXPECT_BEFORE = { bytes: 2936339, md5: 'A3766F48935296C63CD26A8B935AAA28' };
const EXPECT_AFTER = { bytes: 2936339, md5: 'A3766F48935296C63CD26A8B935AAA28' };

const write = process.argv.includes('--write');
const force = process.argv.includes('--force');

/**
 * 计算字节的 MD5（大写，与 PowerShell Get-FileHash 对齐）
 * @param {Buffer|string} buf 内容
 * @returns {string}
 */
const md5 = (buf) => createHash('md5').update(buf).digest('hex').toUpperCase();

/**
 * 截取 `function NAME(` 到配对 `}`
 * @param {string} src 源码
 * @param {string} name 函数名
 * @returns {string}
 */
function grabFn(src, name) {
  const head = src.indexOf('function ' + name + '(');
  if (head < 0) throw new Error('missing fn ' + name);
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  throw new Error('unbalanced fn ' + name);
}

/**
 * 返回函数（含其前面的 /** 注释）的 [start, end) 区间
 * @param {string} src 源码
 * @param {string} name 函数名
 * @returns {number[]}
 */
function fnSpan(src, name) {
  const head = src.indexOf('function ' + name + '(');
  if (head < 0) throw new Error('missing fn ' + name);
  const fn = grabFn(src, name);
  const doc = src.lastIndexOf('/**', head);
  const start = (doc > 0 && src.slice(doc, head).indexOf('*/') > -1) ? doc : head;
  return [start, src.indexOf(fn, head) + fn.length];
}

/**
 * 用新代码整体替换一个函数（连旧注释一起换掉）
 * @param {string} src 源码
 * @param {string} name 函数名
 * @param {string} next 新函数文本
 * @returns {string}
 */
function replaceFn(src, name, next) {
  const [a, b] = fnSpan(src, name);
  return src.slice(0, a) + next + src.slice(b);
}

if (!existsSync(MAIN)) throw new Error('主文件不存在: ' + MAIN);
if (!existsSync(PAYLOAD)) throw new Error('payload 不存在: ' + PAYLOAD);

const payload = readFileSync(PAYLOAD, 'utf8');
const mainBuf = readFileSync(MAIN);
const text0 = mainBuf.toString('utf8');

// ---------- 1) 锚点命中检查（行号不参与定位） ----------
const count = (needle) => text0.split(needle).length - 1;
const anchorRuntime = `/** 标题背景运行时：running / frames 供验收读取，stars+diff 只在初始化时生成一次 */
const titleBgRuntime = {
  running: false,
  frames: 0,
  raf: 0,
  w: 0,
  h: 0,
  stars: [],
  dust: []
};`;

const hits = {
  A1_runtime: count(anchorRuntime),
  A2_resize: count('function resizeTitleBg() {'),
  A3_draw: count('function drawTitleBackground(ts) {'),
  A4_start: count('function startTitleBackground() {'),
  A5_stopCheck: count('function stopTitleBackground() {')
};

const bad = Object.entries(hits).filter(([k, v]) => (k === 'A5_stopCheck' ? v !== 1 : v !== 1));
// A1 是「贴前」的 runtime 原文；贴过一次后它必然被替换掉（hits=0）。
// 所以先用贴后特征串判定"已经在树内"，避免把「已落地」误报成「结构被改」。
const APPLIED_MARK = 'const TITLE_BG_OFF = /[?&]bg=off(?:&|$)/.test(location.search);';
if (hits.A1_runtime === 0 && text0.includes(APPLIED_MARK)) {
  console.log('本补丁已在树内（A1 已被替换为含 TITLE_BG_OFF 的新 runtime），无需二次贴。');
  console.log('锚点：', hits);
  process.exit(0);
}
if (bad.length) {
  console.error('✗ 锚点命中异常：', hits);
  console.error('  若 A1 命不中且没有 TITLE_BG_OFF，说明 runtime 结构被别的线改过；请改用 TITLE_BG_PATCH.md §3 手工核对。');
  process.exit(2);
}

// ---------- 2) 四处替换 ----------
let text = text0;

text = text.replace(anchorRuntime, `/** 标题背景运行时：running / frames / dpr 供验收读取；stars+dust 仅旧版背景使用 */
/** ?bg=off：整层背景关闭（画布隐藏、不排队 rAF），用于兜底与 A/B */
const TITLE_BG_OFF = /[?&]bg=off(?:&|$)/.test(location.search);
const titleBgRuntime = {
  running: false,
  frames: 0,
  raf: 0,
  w: 0,
  h: 0,
  dpr: 1,
  stars: [],
  dust: []
};`);

text = replaceFn(text, 'resizeTitleBg', `/**
 * 同步标题画布尺寸（dpr 上限写死 1.5：高分屏只吃 1.5 倍像素，成本可控、线宽稳定）
 * @returns {HTMLCanvasElement|null} 画布
 */
function resizeTitleBg() {
  const canvas = document.getElementById('titleBg');
  if (!canvas) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(320, canvas.clientWidth || window.innerWidth || 320);
  const h = Math.max(320, canvas.clientHeight || window.innerHeight || 320);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  titleBgRuntime.w = w;
  titleBgRuntime.h = h;
  titleBgRuntime.dpr = dpr;
  // 前景徽记是同一次 resize 里的另一张画布，一并同步尺寸（否则高 DPI 切换会糊）
  const em = document.getElementById('titleEmblem');
  if (em) {
    const s = Math.max(120, Math.round(Math.min(em.clientWidth, em.clientHeight) || 220));
    if (em.width !== s) em.width = s;
    if (em.height !== s) em.height = s;
    titleEmblemRuntime.w = s;
    titleEmblemRuntime.h = s;
  }
  return canvas;
}`);

const drawFn = `/**
 * 画一帧标题背景：方向一 · 符阵（透视地面符阵 + 缓慢旋转 + 不闭合咒文弧）
 * @param {number} ts requestAnimationFrame 时间戳
 * @returns {void}
 */
function drawTitleBackground(ts) {
  const canvas = document.getElementById('titleBg');
  if (!canvas || TITLE_BG_OFF) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = titleBgRuntime.w || canvas.width;
  const h = titleBgRuntime.h || canvas.height;
  const t = Number(ts || 0) / 1000;

  TBG_SIGIL.draw(ctx, w, h, titleBgRuntime.dpr || 1, t);

  // 前景徽记：与背景共用同一帧时钟，保证两层景深同步转动
  drawTitleEmblem(ts);

  titleBgRuntime.frames += 1;
}`;

text = replaceFn(text, 'drawTitleBackground', payload + '\n\n' + drawFn);

text = replaceFn(text, 'startTitleBackground', `/**
 * 启动标题背景（重复调用安全；?bg=off 时直接收摊，不排队 rAF）
 * @returns {void}
 */
function startTitleBackground() {
  const canvas = resizeTitleBg();
  if (!canvas) return;
  if (TITLE_BG_OFF) {
    canvas.style.display = 'none';
    stopTitleBackground();
    return;
  }
  canvas.style.display = '';
  initTitleBackgroundLayers();
  if (titleBgRuntime.running) return;
  titleBgRuntime.running = true;
  titleBgRuntime.raf = requestAnimationFrame(titleBgLoop);
}`);

const afterBuf = Buffer.from(text, 'utf8');
const beforeMD5 = md5(mainBuf);
const afterMD5 = md5(afterBuf);

console.log('锚点命中：', hits);
console.log('贴前：', mainBuf.length, 'B /', beforeMD5);
console.log('贴后：', afterBuf.length, 'B /', afterMD5);
console.log('增量：+' + (afterBuf.length - mainBuf.length) + ' B');
console.log('构建基线是否命中：', beforeMD5 === EXPECT_BEFORE.md5 ? `是（贴后应命中 ${EXPECT_AFTER.md5.slice(0, 8)}…）` : '否（基线已漂移，以现算贴后值为准）');

if (!write) {
  console.log('\n[dry-run] 未写入。确认无误后加 --write 执行。');
  process.exit(0);
}

// ---------- 3) 写入 + 回读 ----------
if (beforeMD5 !== EXPECT_BEFORE.md5 && !force) {
  console.error('\n✗ 贴前 MD5 与构建基线不一致（主文件被并行写过）。');
  console.error('  请先确认合并顺序，或加 --force 以当前内容为基线继续。');
  process.exit(3);
}

writeFileSync(MAIN, afterBuf);

const backBuf = readFileSync(MAIN);
const backMD5 = md5(backBuf);
if (backBuf.length !== afterBuf.length || backMD5 !== afterMD5) {
  console.error('✗ 回读校验失败：', backBuf.length, 'B /', backMD5);
  process.exit(4);
}

console.log('\n✓ 已写入并回读校验通过：', backBuf.length, 'B /', backMD5);
if (afterMD5 !== EXPECT_AFTER.md5) {
  console.log('  注意：贴前基线已漂移，贴后 MD5 与构建快照不同属正常，请把实际值记入合并日志。');
}
console.log('  下一步：1280×800@dpr2 截图 + ?bg=off + 进游戏 frames 冻结三项验收。');
