// 迷雾亮度诊断：定位「未探索区最亮像素」到底是什么（只读，不改游戏文件）
// 用法：node _probe/fog_max_probe.js [被测文件]
const path = require('path');
const { openPreview } = require(path.join(__dirname, '..', 'tools', 'preview_cdp.js'));

const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');

const EXPR = `(async () => {
  const PURE = ${process.argv.includes('--pure') ? 'true' : 'false'};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 进入战斗：开始探索 → 选角 → 确认 */
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
  window.__roamDebug.xp.setEnabled(false);
  for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
  window.__roamDebug.setFloor(6);
  for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
  await sleep(900);

  // --pure：关掉会透光的场景层（缝隙/网格/泛光），只看雾本身
  if (PURE) {
    window.__roamDebug.fogLab.setSeam(0);
    window.__roamDebug.fogLab.setBloom(false);
    await sleep(700);
  }

  // 复刻 fogLab.measure 的选区逻辑，但额外记录最亮像素的坐标与颜色
  const z = cameraZoom();
  let best = null;
  state.rooms.forEach((room) => {
    if (!room || room.visited || state.fog.seenRooms[room.id]) return;
    const sx = (room.cx - room.w / 2 - state.cam.x) * z;
    const sy = (room.cy - room.h / 2 - state.cam.y) * z;
    const sw = room.w * z, sh = room.h * z;
    const x0 = Math.max(sx, 0), y0 = Math.max(sy, 0);
    const x1 = Math.min(sx + sw, window.innerWidth);
    const y1 = Math.min(sy + sh, window.innerHeight);
    const iw = x1 - x0, ih = y1 - y0;
    if (iw < 120 || ih < 90) return;
    if (!best || iw * ih > best.iw * best.ih) best = { x: x0, y: y0, iw, ih, id: room.id };
  });
  if (!best) return { error: '屏幕内没有足够大的未探索房' };

  const c = document.getElementById('game');
  const dpr = c.width / window.innerWidth;
  const pad = 26;
  const rx = Math.round((best.x + pad) * dpr);
  const ry = Math.round((best.y + pad) * dpr);
  const rw = Math.max(1, Math.round((best.iw - pad * 2) * dpr));
  const rh = Math.max(1, Math.round((best.ih - pad * 2) * dpr));
  const img = c.getContext('2d').getImageData(rx, ry, rw, rh);
  const data = img.data;

  const px = [];
  for (let y = 0; y < rh; y += 1) {
    for (let x = 0; x < rw; x += 1) {
      const i = (y * rw + x) * 4;
      const l = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (l > 12) px.push({ x, y, r: data[i], g: data[i + 1], b: data[i + 2], l: +l.toFixed(1) });
    }
  }
  px.sort((a, b) => b.l - a.l);

  // 统计“高亮像素离选区边缘多远”，判断是不是贴边渗光
  const edgeDist = (p) => Math.min(p.x, p.y, rw - 1 - p.x, rh - 1 - p.y);
  const top = px.slice(0, 12).map((p) => ({ x: p.x, y: p.y, rgb: p.r + ',' + p.g + ',' + p.b, l: p.l, edgeDist: edgeDist(p) }));

  return {
    floor: state.floor,
    mode: state.mode,
    roomId: best.id,
    sample: { rx, ry, rw, rh, dpr, totalPx: rw * rh },
    over12: px.length,
    over12Ratio: +(px.length / (rw * rh) * 100).toFixed(3),
    maxEdgeDist: px.length ? Math.max.apply(null, px.map(edgeDist)) : null,
    nearEdge: px.filter((p) => edgeDist(p) <= 8).length,
    interior: px.filter((p) => edgeDist(p) > 8).length,
    top
  };
})()`;

(async () => {
  const r = await openPreview(FILE, EXPR, { waitMs: 8000, timeoutMs: 60000 });
  console.log(JSON.stringify(r, null, 2));
})().catch((e) => { console.error('PROBE FAILED:', e && e.message); process.exit(1); });
