/* 无障碍 P0 · 离线对照 + 静态锚点断言
 * ------------------------------------------------------------
 * 目的：不改主文件，先回答三个"改了会不会出事"的问题：
 *   1) PIXEL_FX_CONFIG.tier.minGap 0.25 → 0.34 会不会吃掉整屏演出链？
 *   2) 滚动 1 秒 ≤3 次闪白 与 同帧合并 是否互相抵消？
 *   3) POSTFX_CONFIG 三档动效参数的写入位置是否会踩 TDZ（定义晚于调用）？
 *
 * 门逻辑逐行复刻主文件 requestScreenFx（第 31353–31359 行）：
 *   if (prev && prev.t < prev.dur * 0.65 && fxScreenTier(prev.kind) >= tier) return false;
 *   if (prev && prev.t < cfg.tier.minGap) return false;
 * 以及 fxScreenTier 的档位表（第 31335–31342 行）。
 * 脚本同时断言主文件里这几条表达式仍在原位，代码漂了就直接 FAIL。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = 'D:/其他/TRAE宝/奥术工程师';
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const txt = fs.readFileSync(SRC, 'utf8');

let fails = 0;
/** 断言并打印结果 */
function check(name, ok, detail) {
  if (!ok) fails += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

/* ---------- 0. 静态锚点 ---------- */

/* 报告把 minGap 写成 FX_TIER_CONFIG.minGap；实际定义在 PIXEL_FX_CONFIG.tier 里。
   先按块截取，避免正则越界把后面 SPIRIT_CONFIG.minGap 一起算进来。 */
const fxBlock = (() => {
  const i = txt.indexOf('const FX_TIER_CONFIG');
  const j = txt.indexOf('\n};', i);
  return i >= 0 && j > i ? txt.slice(i, j) : '';
})();
check('FX_TIER_CONFIG 内不存在 minGap（报告锚点写错）', fxBlock.length > 0 && !/minGap/.test(fxBlock));
check('PIXEL_FX_CONFIG.tier 仍为 maxLayers:1 / minGap:0.25',
  /tier:\s*\{\s*maxLayers:\s*1\s*,\s*minGap:\s*0\.25\s*\}/.test(txt));
check('requestScreenFx 的 minGap 门仍在原位', /if\s*\(prev\s*&&\s*prev\.t\s*<\s*cfg\.tier\.minGap\)/.test(txt));
check('fxScreenTier 档位表仍在原位',
  /if\s*\(kind\s*===\s*'death'\)\s*return\s*4;/.test(txt)
  && /if\s*\(kind\s*===\s*'bossPhase'\)\s*return\s*3;/.test(txt)
  && /if\s*\(kind\s*===\s*'descend'\)\s*return\s*3;/.test(txt));

/* flashScreen 内目前没有任何"秒级计数"门，只有 reduceFlash 早退 */
const flashBody = (() => {
  const i = txt.indexOf('function flashScreen(');
  const j = txt.indexOf('\n}', i);
  return txt.slice(i, j);
})();
check('flashScreen 内无时间/频率门（4 次/秒的来源不是 minGap）',
  !/perSec|windowSec|flashRate|lastFlashAt/.test(flashBody));
check('flashScreen 的收尾 setTimeout 没有序号令牌（旧闪会把新闪提前摘掉）',
  /setTimeout\s*\(\s*\(\)\s*=>\s*\{\s*ui\.flash\.classList\.remove\('is-on'\)/.test(flashBody)
  && !/flashSeq|flashToken/.test(flashBody));

/* a11y.contrast 零行为引用：只允许定义处与调试快照各 1 次 */
const contrastHits = [...txt.matchAll(/a11y\.contrast/g)].length;
const contrastLiteral = [...txt.matchAll(/contrast:\s*'normal'/g)].length;
check('a11y.contrast 零行为读取：点访问 0 次，字段只在配置里出现 1 次',
  contrastHits === 0 && contrastLiteral === 1, `点访问=${contrastHits} 次 / 字面量=${contrastLiteral} 次`);

/* 设置页那颗开关只写 colorblind；标签却叫「色盲 / 高对比」 */
check('「色盲 / 高对比」开关只写 a11y.colorblind，没有 contrast 写入点',
  /function setColorblind\(on\)\s*\{[\s\S]*?a11y\.colorblind\s*=\s*!!on;[\s\S]*?\n\}/.test(txt)
  && !/setColorblind[\s\S]{0,400?}contrast/.test(txt));
check('meta 存档白名单无 contrast 字段（开关状态根本没落盘）',
  !/base\.contrast\s*=/.test(txt) && !/contrast:\s*(true|false)/.test(txt));

/* POSTFX_CONFIG 定义位置早于首次 requestAnimationFrame(loop)，运行时读取不踩 TDZ */
const postfxAt = txt.indexOf('const POSTFX_CONFIG');
const firstLoopAt = txt.indexOf('requestAnimationFrame(loop)');
check('POSTFX_CONFIG 定义早于主循环启动（可安全写入三档参数）',
  postfxAt > 0 && firstLoopAt > postfxAt, `POSTFX@${postfxAt} < loop@${firstLoopAt}`);

/* 5 行 CSS 的落地现状 */
check('锁定卡名仍是 .55（未落地）',
  /\.mini-card\.is-locked \.m-name\s*\{[^}]*color:\s*rgba\(150,\s*180,\s*214,\s*0\.55\)/.test(txt));
check('铭文标签仍是 .5（未落地）',
  /\.spirit-line \.spirit-tag\s*\{[^}]*color:\s*rgba\(143,\s*228,\s*255,\s*0\.5\)/.test(txt));
check('楼层竖排仍是 .66（未落地）',
  /body\.ui-v2 \.floor-head span\s*\{[\s\S]*?color:\s*rgba\(150,\s*222,\s*255,\s*0\.66\)/.test(txt));
check('史诗文字已用 --rar-epic-text（这项已落地，勿重复粘）',
  /--rar-epic-text:\s*#c9a6ff/.test(txt)
  && /\.reward-card\.rarity-epic \.r-rarity\s*\{\s*color:\s*var\(--rar-epic-text\)/.test(txt));
check('稀有文字仍取 --rar-rare（缺 --rar-rare-text）',
  !/\-\-rar-rare-text/.test(txt));

/* ---------- 1. minGap 0.25 vs 0.34 对照 ---------- */

/** fxScreenTier 复刻 */
function tierOf(kind) {
  if (kind === 'death') return 4;
  if (kind === 'bossPhase') return 3;
  if (kind === 'descend') return 3;
  if (kind === 'milestone') return 2;
  if (kind === 'clear') return 2;
  return 1;
}

/**
 * 复刻 requestScreenFx 的准入判定
 * @param {{kind:string,dur:number}|null} prev 上一段整屏演出
 * @param {number} dt 距上一段开始的秒数
 * @param {string} kind 新演出类型
 * @param {number} minGap 最小间隔
 * @returns {{ok:boolean, by:string}} 结果与拦截原因
 */
function admit(prev, dt, kind, minGap) {
  if (prev && dt < prev.dur * 0.65 && tierOf(prev.kind) >= tierOf(kind)) {
    return { ok: false, by: 'playing65' };
  }
  if (prev && dt < minGap) return { ok: false, by: 'minGap' };
  return { ok: true, by: '-' };
}

const chains = [
  { from: 'clear', dur: 0.42, to: 'descend', label: '清房 → 下楼' },
  { from: 'clear', dur: 0.42, to: 'bossPhase', label: '清房 → 首领阶段' },
  { from: 'milestone', dur: 0.75, to: 'descend', label: '里程碑 → 下楼' },
  { from: 'clear', dur: 0.42, to: 'milestone', label: '清房 → 里程碑（同档）' }
];
const dts = [0.26, 0.30, 0.33];
console.log('\n-- minGap 对照（●=放行 / ○=被 minGap 拦）--');
for (const c of chains) {
  const cells = dts.map((dt) => {
    const a025 = admit({ kind: c.from, dur: c.dur }, dt, c.to, 0.25);
    const a034 = admit({ kind: c.from, dur: c.dur }, dt, c.to, 0.34);
    return `${dt}s:${a025.ok ? '●' : '○'}/${a034.ok ? '●' : '○'}`;
  });
  console.log(`${c.label.padEnd(22)} ${cells.join('  ')}   (左 0.25 / 右 0.34)`);
}
/* 结论断言：必须存在"0.25 放行、0.34 拦截"的格子，否则对照无意义 */
const hasRegression = chains.some((c) => dts.some((dt) => {
  const a025 = admit({ kind: c.from, dur: c.dur }, dt, c.to, 0.25);
  const a034 = admit({ kind: c.from, dur: c.dur }, dt, c.to, 0.34);
  return a025.ok && !a034.ok;
}));
check('0.34 确实会在"低档→高档"链上新增拦截（存在回归格）', hasRegression);

/* ---------- 2. 滚动 1 秒 ≤3 次：滚动窗口 vs 固定秒桶 ---------- */

/**
 * 滚动窗口计数
 * @param {number[]} ts 毫秒时间戳（升序）
 * @param {number} limit 1 秒内上限
 * @returns {number} 放行数
 */
function rollingCap(ts, limit) {
  const kept = [];
  for (const t of ts) {
    while (kept.length && t - kept[0] >= 1000) kept.shift();
    if (kept.length < limit) kept.push(t);
  }
  return kept.length;
}
/**
 * 固定秒桶计数（错误示范：秒边界两侧各放 3 次）
 * @param {number[]} ts 毫秒时间戳
 * @param {number} limit 每秒上限
 * @returns {number} 放行数
 */
function bucketCap(ts, limit) {
  const bucket = {};
  let kept = 0;
  for (const t of ts) {
    const b = Math.floor(t / 1000);
    bucket[b] = bucket[b] || 0;
    if (bucket[b] < limit) { bucket[b] += 1; kept += 1; }
  }
  return kept;
}

const burst = [0, 103.7, 207.4, 311.1];                    // 报告实测的最小间隔
const straddle = [990, 1000, 1010, 1020, 1030, 1040];       // 跨秒边界的 6 连
console.log('\n-- 闪白计数对照（上限 3）--');
console.log(`实测 4 连（103.7ms 间隔）：滚动=${rollingCap(burst, 3)} 固定桶=${bucketCap(burst, 3)}`);
console.log(`跨秒 6 连：滚动=${rollingCap(straddle, 3)} 固定桶=${bucketCap(straddle, 3)}`);
check('滚动窗口把 4 连压到 3', rollingCap(burst, 3) === 3);
check('固定秒桶在跨秒边界漏出 4 连（50ms 内，所以必须用滚动窗口）', bucketCap(straddle, 3) === 4);

/* ---------- 3. 同帧合并 vs 秒级上限：不同层，不互相抵消 ---------- */
/* fxTierFlush 每帧最多产出 1 次闪白；秒级上限在 flashScreen 下游。
   60fps 下同帧合并最多把 60 次/秒输入压到 60 次/秒（每帧 1 次），
   实际上限由节流与事件数决定，二者作用层不同。 */
const perFrameCap = 1;
const framesPerSec = 60;
check('同帧合并位于 flashScreen 上游（先合并后计数，不重复扣次数）',
  txt.indexOf('function fxTierFlush(') < txt.indexOf('function flashScreen('),
  'fxTierFlush 定义在前');
console.log(`同帧合并理论输入上限 = ${perFrameCap * framesPerSec}/s（每帧 1 次），秒级上限在其下游生效`);

console.log('\n结果：' + (fails === 0 ? 'ALL PASS' : fails + ' FAIL'));
process.exit(fails === 0 ? 0 : 1);
