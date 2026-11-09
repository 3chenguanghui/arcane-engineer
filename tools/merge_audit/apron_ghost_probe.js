// 路虚影探针：同一次打开、同一机位，量「房间地面被地面延伸带覆盖的像素占比」改前/改后。
// 用法：node tools/merge_audit/apron_ghost_probe.js
// 说明：只在页面运行时抠掉延伸带像素，不改主文件；输出 before/after 两张裁切图。
const fs = require('fs');
const path = require('path');
const { openPreview } = require('../preview_cdp');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'MERGE-QUEUE.assets');

/**
 * 在页面里执行的探针：生成楼层 → 统计延伸带覆盖 → 截屏 → 运行时抠除 → 再统计/再截屏
 * @returns {Promise<Object>} before/after 覆盖占比、两张 PNG dataURL、几何统计
 */
function pageExpr() {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = window.__roamDebug || {};
    const SF = (D.onboard && D.onboard.showFloor) || D.showFloor;
    if (typeof SF !== 'function') return { error: 'no showFloor (onboard/top)' };

    try { SF.call(D.onboard || D, 3); } catch (e) { return { error: 'showFloor: ' + e.message }; }
    await sleep(3200);

    if (typeof state === 'undefined' || !state || !state.rooms) return { error: 'no global state' };
    if (typeof apronCtx === 'undefined' || !apronCtx) return { error: 'no apronCtx' };

    const s = state;
    const scale = PARALLAX_CONFIG.apron.scale;
    const W = apronCanvas.width;
    const H = apronCanvas.height;

    /** 统计所有房间地面内不同可见阈值下 alpha 命中占比（3=任意，16=肉眼可辨，32=明显亮带） */
    const coverage = () => {
      const img = apronCtx.getImageData(0, 0, W, H).data;
      const hit = { a3: 0, a16: 0, a32: 0 };
      let tot = 0;
      s.rooms.forEach((r) => {
        for (let y = r.y + 2; y < r.y + r.h - 2; y += 2) {
          for (let x = r.x + 2; x < r.x + r.w - 2; x += 2) {
            tot += 1;
            const cx = Math.min(W - 1, Math.round(x * scale));
            const cy = Math.min(H - 1, Math.round(y * scale));
            const a = img[(cy * W + cx) * 4 + 3];
            if (a > 3) hit.a3 += 1;
            if (a > 16) hit.a16 += 1;
            if (a > 32) hit.a32 += 1;
          }
        }
      });
      const pct = (n) => (tot ? +(n * 100 / tot).toFixed(1) : 0);
      return { tot, a3: pct(hit.a3), a16: pct(hit.a16), a32: pct(hit.a32) };
    };

    /**
     * 截图：把「静态场景底图 + 地面延伸带」按世界坐标 1:1 合成后裁切，
     * 不走主循环、不含怪与动画 —— 改前/改后除延伸带外逐像素相同。
     */
    const shot = () => {
      const W = GAME_CONFIG.worldWidth;
      const H = GAME_CONFIG.worldHeight;
      const comp = document.createElement('canvas');
      comp.width = W; comp.height = H;
      const cg = comp.getContext('2d');
      cg.drawImage(sceneCanvas, 0, 0, sceneCanvas.width, sceneCanvas.height, 0, 0, W, H);
      if (apronCanvas) cg.drawImage(apronCanvas, 0, 0, apronCanvas.width, apronCanvas.height, 0, 0, W, H);
      const c = document.createElement('canvas');
      c.width = 440; c.height = 620;
      const g = c.getContext('2d');
      const cx = Math.round(s.player.x - 220);
      const cy = Math.round(s.player.y - 310);
      g.drawImage(comp, Math.max(0, cx), Math.max(0, cy), 440, 620, 0, 0, 440, 620);
      return c.toDataURL('image/png');
    };

    // 固定机位：清掉会动的实体，确保改前/改后只差延伸带这一层
    try {
      s.player.vx = 0; s.player.vy = 0;
      (s.enemies || []).length = 0;
      s.cam.x = s.player.x; s.cam.y = s.player.y;
    } catch (e) {}
    await sleep(500);
    const camA = { x: Math.round(s.cam.x), y: Math.round(s.cam.y), zoom: +(s.cam.zoom || 0).toFixed(3) };

    const before = coverage();
    const pngA = shot();

    // 运行时抠除：等价于补丁在烘焙期 clearRect(房间/走廊/秘藏房)
    const id = apronCtx.getImageData(0, 0, W, H);
    const punch = (r) => {
      if (!r) return;
      const x0 = Math.max(0, Math.floor((r.x + 1) * scale));
      const y0 = Math.max(0, Math.floor((r.y + 1) * scale));
      const x1 = Math.min(W, Math.ceil((r.x + r.w - 1) * scale));
      const y1 = Math.min(H, Math.ceil((r.y + r.h - 1) * scale));
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) id.data[(y * W + x) * 4 + 3] = 0;
      }
    };
    s.rooms.forEach(punch);
    (s.corridorRects || []).forEach(punch);
    punch(s.hiddenRoom);
    apronCtx.putImageData(id, 0, 0);

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleep(300);

    const after = coverage();
    const pngB = shot();
    const camB = { x: Math.round(s.cam.x), y: Math.round(s.cam.y), zoom: +(s.cam.zoom || 0).toFixed(3) };

    return {
      floor: s.floor,
      rooms: s.rooms.length,
      corridors: (s.corridorRects || []).length,
      roomAlpha: PARALLAX_CONFIG.apron.alpha,
      corridorAlpha: +(PARALLAX_CONFIG.apron.alpha * 0.75).toFixed(4),
      roomAlpha8: Math.round(PARALLAX_CONFIG.apron.alpha * 255),
      corridorAlpha8: Math.round(PARALLAX_CONFIG.apron.alpha * 0.75 * 255),
      camA, camB,
      before, after, pngA, pngB
    };
  })()`;
}

(async () => {
  const r = await openPreview('index_arcane_v2.html', pageExpr(), { waitMs: 900, timeoutMs: 20000 });
  if (r.value && r.value.error) {
    console.log('PROBE ERROR:', r.value.error);
    process.exitCode = 1;
    return;
  }
  const v = r.value;
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const save = (name, dataUrl) => {
    const b64 = String(dataUrl || '').split(',')[1] || '';
    fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64'));
  };
  save('ghost_before.png', v.pngA);
  save('ghost_after.png', v.pngB);
  console.log(JSON.stringify({
    floor: v.floor,
    rooms: v.rooms,
    corridors: v.corridors,
    roomAlpha8: v.roomAlpha8,
    corridorAlpha8: v.corridorAlpha8,
    camA: v.camA,
    camB: v.camB,
    before: v.before,
    after: v.after,
    errors: r.errors
  }, null, 2));
})();
