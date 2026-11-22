/**
 * 改前基线：直接打开 delivery 里的交付版（只读，绝不写回），
 * 用与 mfix 完全相同的测量函数与机位（844×390、非触屏），得到可对比的"改前"读数。
 * 用法：node mobile/tools/mbefore.js [--force]
 * 产物：mobile/shots/before_delivery_844x390.jpg 与 shots/before.json
 */
const fs = require('fs');
const path = require('path');
const { bootEdge, setViewport, openBattle, injectNoTouch, MEASURE_JS, envGuard } = require('./mfix');

const MOBILE_DIR = path.join(__dirname, '..');
const OUT_DIR = path.join(MOBILE_DIR, 'shots');
const DELIVERY = path.join(MOBILE_DIR, '..', 'delivery', '烬-奥术工程师-试玩版.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程：交付版 844×390 非触屏 → 测量 + 截图
 * @returns {Promise<void>}
 */
async function main() {
  if (!envGuard()) { process.exitCode = 3; return; }
  const md5 = require('crypto').createHash('md5').update(fs.readFileSync(DELIVERY)).digest('hex').toUpperCase();
  const bytes = fs.statSync(DELIVERY).size;
  console.log(`交付版（只读）：${path.basename(DELIVERY)}  bytes=${bytes}  md5=${md5}`);

  const cdp = await bootEdge();
  try {
    await setViewport(cdp, { w: 844, h: 390, dpr: 3, mobile: true, orientation: 'landscape' }, false);
    const id = await injectNoTouch(cdp, false);
    await openBattle(cdp, '?before=1', DELIVERY);
    await sleep(600);
    const m = await cdp.ev(MEASURE_JS);
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    fs.writeFileSync(path.join(OUT_DIR, 'before_delivery_844x390.jpg'), Buffer.from(r.data, 'base64'));
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id });
    fs.writeFileSync(path.join(OUT_DIR, 'before.json'), JSON.stringify({ bytes, md5, measure: m }, null, 1));
    console.log(`[改前 844×390 非触屏] 重叠=${m.overlapCount} 文字重叠=${m.textOverlapCount} ` +
      `HUDcore=${m.hudCorePct}% HUDctrl=${m.hudCtrlPct}% 可玩带=${m.playBand}px 摇杆=${m.blocks.stick && m.blocks.stick.visible} ` +
      `目标条=${m.blocks.goal && m.blocks.goal.visible} 小地图顶出=${m.blocks.minimap ? m.blocks.minimap.y : '-'}px`);
    console.log('已写 mobile/shots/before.json');
  } finally {
    cdp.close();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
