// 门可读性探针：同一房间、同一机位，量「门区域亮度 vs 环境亮度」并输出 100% / 25% 两张图。
// 用法：node tools/merge_audit/door_readability_probe.js
// 只读主文件；"改后"是在渲染完成后把补丁里的地面光带按同一几何画一遍（不写主文件）。
const fs = require('fs');
const path = require('path');
const { openPreview } = require('../preview_cdp');

const OUT = path.join(__dirname, '..', '..', 'MERGE-QUEUE.assets');

/**
 * 在页面里执行的探针：选门最多的房间 → 置为"已清场可通行" → 量亮度 → 截图 → 注入光带 → 再量/再截
 * @returns {Promise<Object>} 亮度差、门信息、四张 PNG
 */
function pageExpr() {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = window.__roamDebug || {};
    const SF = (D.onboard && D.onboard.showFloor) || D.showFloor;
    if (typeof SF !== 'function') return { error: 'no showFloor' };
    try { SF.call(D.onboard || D, 3); } catch (e) { return { error: 'showFloor: ' + e.message }; }
    await sleep(3200);
    const s = state;
    if (!s || !s.doors) return { error: 'no state.doors' };

    // 选一间门最多的房间（通常就是战斗房，门数 2–4）
    let room = null; let bestN = 0;
    s.rooms.forEach((r) => {
      const n = s.doors.filter((d) => d.roomId === r.id).length;
      if (n > bestN) { bestN = n; room = r; }
    });
    if (!room) return { error: 'no room with doors' };

    // 置为"清场后、门已开"的真实状态（不触发 onRoomCleared 的演出）
    room.locked = false; room.cleared = true; room.visited = true;
    s.doors.forEach((d) => { if (d.roomId === room.id) { d.anim = 0; } });
    (s.enemies || []).length = 0;
    if (s.rings) s.rings.length = 0;
    if (s.floats) s.floats.length = 0;
    s.player.x = room.x + room.w / 2;
    s.player.y = room.y + room.h / 2 + 30;
    s.player.vx = 0; s.player.vy = 0; s.player.invuln = 0;
    await sleep(1400);
    if (s.player.hp <= 0) return { error: 'player died during warmup (hp=' + s.player.hp + ')' };
    (s.enemies || []).length = 0;
    if (s.rings) s.rings.length = 0;
    if (s.floats) s.floats.length = 0;
    try { if (typeof snapCamera === 'function') snapCamera(); } catch (e) {}
    s.elapsed = 12.0;
    render();

    const z = cameraZoom();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = canvas.getContext('2d');
    const toScr = (wx, wy) => [Math.round((wx - s.cam.x) * z * dpr), Math.round((wy - s.cam.y) * z * dpr)];

    /** 读一个方形像素块的亮度统计（Rec.709 加权，0–255） */
    const patch = (sx, sy, rad) => {
      const x = Math.max(0, sx - rad); const y = Math.max(0, sy - rad);
      const w = Math.min(canvas.width - x, rad * 2); const h = Math.min(canvas.height - y, rad * 2);
      if (w <= 0 || h <= 0) return { mean: 0, max: 0, x: 0, y: 0, w: 0, h: 0 };
      const d = c.getImageData(x, y, w, h).data;
      let sum = 0; let max = 0; let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += L; if (L > max) max = L; n += 1;
      }
      return { mean: +(sum / n).toFixed(1), max: Math.round(max), x, y, w, h };
    };

    const myDoors = s.doors.filter((d) => d.roomId === room.id);
    const envP = toScr(room.x + room.w / 2, room.y + room.h / 2);
    const rad = Math.round(26 * dpr);

    /** 每扇门：门心 26px 方块 vs 房间中心地面 26px 方块 */
    const measure = () => {
      const env = patch(envP[0], envP[1], rad);
      const list = myDoors.map((d) => {
        const p = toScr(d.x, d.y);
        const got = patch(p[0], p[1], rad);
        return {
          side: d.side,
          state: (typeof doorVisFor === 'function' && doorVisFor(d) || {}).state || '?',
          doorMean: got.mean, doorMax: got.max,
          envMean: env.mean
        };
      });
      const maxDelta = Math.max.apply(null, list.map((it) => Math.abs(it.doorMean - it.envMean)));
      return { env, doors: list, maxDelta: +maxDelta.toFixed(1) };
    };

    /** 裁房间外框（含 24px 边），按 factor 缩放输出 PNG */
    const capCrop = (factor) => {
      const a = toScr(room.x, room.y);
      const b = toScr(room.x + room.w, room.y + room.h);
      const x0 = Math.max(0, a[0] - 24); const y0 = Math.max(0, a[1] - 24);
      const w = Math.min(canvas.width - x0, (b[0] - a[0]) + 48);
      const h = Math.min(canvas.height - y0, (b[1] - a[1]) + 48);
      const o = document.createElement('canvas');
      o.width = Math.max(1, Math.round(w * factor));
      o.height = Math.max(1, Math.round(h * factor));
      const g = o.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(canvas, x0, y0, w, h, 0, 0, o.width, o.height);
      return o.toDataURL('image/png');
    };

    const before = measure();
    const statsBefore = Object.assign({}, DOOR_VIS_STATS);
    const before100 = capCrop(1);
    const before25 = capCrop(0.25);

    /* 渲染结束时 ctx 的变换不是世界坐标系，注入前必须显式设回
       （与 render() 的链一致：dpr → cameraZoom → 平移 -cam） */
    const worldTransform = () => {
      ctx.setTransform(dpr * z, 0, 0, dpr * z, -s.cam.x * z * dpr, -s.cam.y * z * dpr);
    };

    /**
     * 补丁同款「地面光带」：从门心朝房心的一道渐变楔形光（'lighter' 混合，不挡视线）
     * 这里只用于出"改后"对比图；正式补丁把它放进 drawDoors() 的门循环里。
     */
    const beam = (door, vis) => {
      const cx = room.x + room.w / 2; const cy = room.y + room.h / 2;
      let ux = door.x - cx; let uy = door.y - cy;
      const len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
      const L = Math.min(room.w, room.h) * 0.5;
      const halfStart = ROOM_FLOW_CONFIG.doorBarWidth * 0.5;
      const halfEnd = 10;
      const pulse = 0.78 + 0.22 * Math.sin(s.elapsed * 2.3 + door.x * 0.02);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(door.x, door.y, door.x - ux * L, door.y - uy * L);
      g.addColorStop(0, hexToRgba(vis.color, 0.38 * pulse));
      g.addColorStop(0.4, hexToRgba(vis.color, 0.2 * pulse));
      g.addColorStop(1, hexToRgba(vis.color, 0));
      ctx.fillStyle = g;
      const px = -uy; const py = ux;               // 垂直于门向的单位向量
      const ex = door.x - ux * L; const ey = door.y - uy * L;
      ctx.beginPath();
      ctx.moveTo(door.x + px * halfStart, door.y + py * halfStart);
      ctx.lineTo(ex + px * halfEnd, ey + py * halfEnd);
      ctx.lineTo(ex - px * halfEnd, ey - py * halfEnd);
      ctx.lineTo(door.x - px * halfStart, door.y - py * halfStart);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    /** 补丁同款「门框描边」：3px、alpha 0.85（原 2px / 0.5–0.7） */
    const frame = (door, vis) => {
      const halfLong = ROOM_FLOW_CONFIG.doorBarWidth * 0.5;
      ctx.save();
      ctx.strokeStyle = hexToRgba(vis.color, 0.85);
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (door.side === 'top' || door.side === 'bottom') {
        const dy = door.side === 'top' ? -10 : 10;
        ctx.moveTo(door.x - halfLong, door.y); ctx.lineTo(door.x - halfLong, door.y + dy);
        ctx.moveTo(door.x + halfLong, door.y); ctx.lineTo(door.x + halfLong, door.y + dy);
      } else {
        const dx = door.side === 'left' ? -10 : 10;
        ctx.moveTo(door.x, door.y - halfLong); ctx.lineTo(door.x + dx, door.y - halfLong);
        ctx.moveTo(door.x, door.y + halfLong); ctx.lineTo(door.x + dx, door.y + halfLong);
      }
      ctx.stroke();
      ctx.restore();
    };

    // 打出"改后"：光带 + 门框加粗 + 光环范围放大到整房（只画本房间的门）
    worldTransform();
    myDoors.forEach((d) => {
      const v = doorVisFor(d);
      if (!v || !v.passable) return;
      beam(d, v);
      frame(d, v);
      drawDoorGlow(d, v, s.elapsed);
    });

    const after = measure();
    const after100 = capCrop(1);
    const after25 = capCrop(0.25);

    return {
      floor: s.floor, room: { id: room.id, type: room.type, w: room.w, h: room.h },
      doors: myDoors.length, radius: rad, zoom: +z.toFixed(3), dpr: dpr,
      dbg: {
        canvas: [canvas.width, canvas.height], cam: [Math.round(s.cam.x), Math.round(s.cam.y)],
        player: [Math.round(s.player.x), Math.round(s.player.y)], hp: s.player.hp, mode: s.mode,
        roomScreen: toScr(room.x, room.y)
      },
      before, after, statsBefore,
      before100, before25, after100, after25
    };
  })()`;
}

(async () => {
  const r = await openPreview('index_arcane_v2.html', pageExpr(), { waitMs: 900, timeoutMs: 22000 });
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
  save('door_before.png', v.before100);
  save('door_before_25.png', v.before25);
  save('door_after.png', v.after100);
  save('door_after_25.png', v.after25);
  console.log(JSON.stringify({
    floor: v.floor, room: v.room, doors: v.doors, zoom: v.zoom, dpr: v.dpr, dbg: v.dbg,
    beforeEnv: v.before.env.mean, beforeDoors: v.before.doors, beforeMaxDelta: v.before.maxDelta,
    afterEnv: v.after.env.mean, afterDoors: v.after.doors, afterMaxDelta: v.after.maxDelta,
    stats: v.statsBefore
  }, null, 2));
})();
