// 只读探针：对比「接线前备份」与「接线后主文件」的运行时配置与 HUD 细条实际宽度。
// 用法：node _probe\unused_keys_parity.js
const path = require('path');
const { openPreview } = require(path.join(__dirname, '..', 'tools', 'preview_cdp'));

// 页面内求值：等待初始化完成后，读取本次接线涉及的 4 个配置与两条 HUD 细条的 computed width
const EXPR = `(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  const tracks = Array.prototype.slice.call(document.querySelectorAll('.od-track'));
  return {
    trackCount: tracks.length,
    widths: tracks.map((e) => getComputedStyle(e).width),
    talentMaxLevel: GAME_CONFIG.talentMaxLevel,
    homingTurnRate: AIM_CONFIG.homingTurnRate,
    unlockClears: ASCENSION_CONFIG.unlockClears,
    hudWidthCfg: OVERDRIVE_CONFIG.hudWidth
  };
})()`;

/** 打开指定页面并返回上面的读数 */
async function read(file) {
  const r = await openPreview(file, EXPR, { waitMs: 6000, timeoutMs: 40000 });
  if (r.errors && r.errors.length) throw new Error(file + ' 页面错误: ' + r.errors.join(' | '));
  return r.value;
}

(async () => {
  const before = await read(path.join(__dirname, '..', '_backup', 'feely_20261110', 'before_unused_keys.html'));
  const after = await read(path.join(__dirname, '..', 'index_arcane_v2.html'));
  console.log('BEFORE ' + JSON.stringify(before));
  console.log('AFTER  ' + JSON.stringify(after));
  const sameWidths = JSON.stringify(before.widths) === JSON.stringify(after.widths);
  console.log('WIDTHS_IDENTICAL=' + sameWidths);
  console.log('NOTE 配置值差异（预期仅 talentMaxLevel 5→3、hudWidth 260→160）:'
    + ' talent=' + before.talentMaxLevel + '→' + after.talentMaxLevel
    + ' hud=' + before.hudWidthCfg + '→' + after.hudWidthCfg);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
