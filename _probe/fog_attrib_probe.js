// 迷雾亮度归因：逐个关掉可能"漏光"的图层，看 max 是否回落（只读，不改游戏文件）
// 用法：node _probe/fog_attrib_probe.js [被测文件]
const path = require('path');
const { openPreview } = require(path.join(__dirname, '..', 'tools', 'preview_cdp.js'));

const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');

const EXPR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function enterPlaying() {
    const btn = document.getElementById('btnStart');
    if (btn) btn.click();
    await sleep(500);
    const cl = document.getElementById('charLayer');
    if (cl && !cl.classList.contains('hidden')) {
      const card = document.querySelector('#charGrid .char-card');
      if (card) card.click();
      await sleep(200);
      const ok = document.getElementById('btnCharConfirm');
      if (ok) ok.click();
    }
    for (let i = 0; i < 60 && state.mode !== 'playing'; i += 1) await sleep(100);
    return state.mode;
  }

  await enterPlaying();
  const d = window.__roamDebug;
  d.xp.setEnabled(false);
  for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
  d.setFloor(6);
  for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
  await sleep(900);

  const snap = () => {
    const m = d.fogLab.measure();
    return m ? { max: m.max, avg: m.avg, p99: m.p99, room: m.roomId } : null;
  };

  const out = {};
  out.base = { cfg: d.fogLab.config(), measure: snap() };

  d.fogLab.setSeam(0);
  await sleep(700);
  out.seam0 = snap();

  d.fogLab.setBloom(false);
  await sleep(500);
  out.seam0_bloomOff = snap();

  d.fogLab.setApron(false);
  await sleep(500);
  out.seam0_bloomOff_apronOff = snap();

  d.fogLab.setSeam(1);
  await sleep(500);
  out.seam1_bloomOff_apronOff = snap();

  d.fogLab.setSecondPass(true);
  d.fogLab.setAlpha(1);
  await sleep(500);
  out.final = { cfg: d.fogLab.config(), measure: snap() };

  return out;
})()`;

(async () => {
  const r = await openPreview(FILE, EXPR, { waitMs: 8000, timeoutMs: 60000 });
  console.log(JSON.stringify(r, null, 2));
})().catch((e) => { console.error('PROBE FAILED:', e && e.message); process.exit(1); });
