/* ============================================================
   A1 · 场景材质与光照 验收脚本（端口 9480）
   ------------------------------------------------------------
   用法：
     node tools/arcane_a1.js before   // 只截图（改代码前跑）
     node tools/arcane_a1.js after    // 截图 + 专项断言 + fps

   同机位规则：setFloor(f) → 取该层战斗房（无则精英房，再退第一间）
   → setPlayerPos(房心)（内部会 snapCamera）→ 截全屏 + 房心裁切特写。
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const MODE = process.argv[2] === 'after' ? 'after' : 'before';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9480;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言结果并打印
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 附加信息（会 JSON 序列化）
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /**
   * 截一张图（可带裁切）
   * @param {string} name 文件名
   * @param {{x:number,y:number,width:number,height:number}} [clip] 裁切区域（CSS 像素）
   */
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) {
      params.clip = { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: clip.width, height: clip.height, scale: 1 };
    }
    const r = await send('Page.captureScreenshot', params);
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };
  const pressKey = async (type, key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };

  await send('Runtime.enable');
  await send('Page.enable');
  /* 1x 设备像素：验收"1x 分辨率下能看出层次" */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  // 点击开始
  const rect = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  const floors = [1, 2, 3];
  const audits = [];
  let perf = null;

  for (const f of floors) {
    await ev(`window.__roamDebug.setFloor(${f})`);
    const pick = await ev(`(function(){
      var d = window.__roamDebug;
      var s = d.getState();
      var room = s.rooms.filter(function(r){ return r.type === 'battle'; })[0]
        || s.rooms.filter(function(r){ return r.type === 'elite'; })[0]
        || s.rooms[0];
      d.setPlayerPos(room.cx, room.cy);
      return { id: room.id, type: room.type, cx: room.cx, cy: room.cy, w: room.w, h: room.h };
    })()`);
    await sleep(650);
    const cam = await ev(`window.__roamDebug.getState().cam`);
    const view = await ev(`window.__roamDebug.getState().view`);

    await shot(`${MODE}-f${f}-battle.png`);

    // 房间特写：以房心在屏幕上的位置为中心裁 560×420（裁到视口内）
    const sx = pick.cx - cam.x;
    const sy = pick.cy - cam.y;
    const cw = 560;
    const ch = 420;
    const clip = {
      x: Math.min(Math.max(0, sx - cw / 2), Math.max(0, view.w - cw)),
      y: Math.min(Math.max(0, sy - ch / 2), Math.max(0, view.h - ch)),
      width: cw,
      height: ch
    };
    await shot(`${MODE}-f${f}-room.png`, clip);

    if (MODE === 'after') {
      const audit = await ev(`(function(){
        var d = window.__roamDebug;
        var s = d.getState();
        var room = s.rooms.filter(function(r){ return r.type === 'battle'; })[0]
          || s.rooms.filter(function(r){ return r.type === 'elite'; })[0]
          || s.rooms[0];
        var snap = d.sceneAudit();
        return { floor: s.floor, theme: snap.theme, roomId: room.id, audit: snap };
      })()`);
      audits.push(audit);
    }
  }

  if (MODE === 'after') {
    /* ---------- fps / 每帧耗时：按住 D 移动 3 秒采样 150 帧 ---------- */
    await ev(`window.__roamDebug.setFloor(1)`);
    await pressKey('keyDown', 'd', 'KeyD', 68);
    perf = await ev(`new Promise(function(resolve){
      var frames = [];
      var last = performance.now();
      var n = 0;
      function tick(now){
        frames.push(now - last);
        last = now;
        n += 1;
        if (n >= 150) {
          var sum = 0, max = 0, min = 1e9;
          frames.forEach(function(dt){
            if (dt <= 0) return;
            sum += dt;
            if (dt > max) max = dt;
            if (dt < min) min = dt;
          });
          var avg = sum / frames.length;
          var d = window.__roamDebug;
          var s = d.getState();
          resolve({
            frames: frames.length,
            avgFrameMs: Number(avg.toFixed(2)),
            maxFrameMs: Number(max.toFixed(2)),
            minFrameMs: Number(min.toFixed(2)),
            avgFps: Number((1000 / avg).toFixed(1)),
            minFps: Number((1000 / max).toFixed(1)),
            scenePatch: s.scenePatch,
            view: s.view,
            drawStats: s.drawStats,
            fogSeen: s.fog ? s.fog.seenRooms : null,
            errors: d.errors()
          });
        } else {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
    })`);
    await pressKey('keyUp', 'd', 'KeyD', 68);
    console.log('PERF · ' + JSON.stringify(perf));

    /* ---------- 断言 ---------- */
    const expected = { 1: 'mech', 2: 'rune', 3: 'void' };
    audits.forEach((item) => {
      ok(`第 ${item.floor} 层主题 = ${expected[item.floor]}`, item.theme === expected[item.floor], { theme: item.theme });
      const rooms = item.audit.rooms;
      const battle = rooms.filter((r) => r.id === item.roomId)[0] || rooms.filter((r) => r.type === 'battle')[0];
      ok(`第 ${item.floor} 层战斗房材质签名存在`, !!battle && (
        item.theme === 'mech' ? battle.sig.metal + battle.sig.weld + battle.sig.rust > 0
          : item.theme === 'rune' ? battle.sig.stone + battle.sig.runeEtch > 0
            : battle.sig.cold + battle.sig.rift + battle.sig.frost > 0
      ), battle ? battle.sig : null);

      // 明度层次：内圈（0.3R 环带，避开中心可能存在的检修沟/管道）比四角亮 ≥10
      const darkRooms = rooms
        .map((r) => ({
          id: r.id,
          type: r.type,
          inner: r.ringLum ? r.ringLum[0] : 0,
          edge: r.edgeLum,
          deltaInner: Number(((r.ringLum ? r.ringLum[0] : 0) - r.edgeLum).toFixed(2))
        }))
        .filter((r) => r.deltaInner < 10);
      ok(`第 ${item.floor} 层所有房间内圈比边缘亮 ≥10`, darkRooms.length === 0, darkRooms);

      // 环带亮度自中心向外不增（容差 6）
      const badRing = rooms.filter((r) => {
        const ring = r.ringLum || [];
        return ring.length >= 3 && (ring[1] - ring[0] > 6 || ring[2] - ring[1] > 6);
      }).map((r) => ({ id: r.id, ring: r.ringLum }));
      ok(`第 ${item.floor} 层环带亮度向外递减`, badRing.length === 0, badRing);

      // 房型装饰密度排序（按实际存在的房型比较）
      const rank = { battle: 5, elite: 4, boss: 3, vault: 3, chest: 2, rest: 1, start: 1, event: 0 };
      const rankOrder = ['battle', 'elite', 'vault', 'chest', 'rest'];
      let orderOk = true;
      const orderDetail = [];
      for (let i = 0; i < rankOrder.length; i += 1) {
        for (let j = i + 1; j < rankOrder.length; j += 1) {
          const a = rooms.filter((r) => r.type === rankOrder[i])[0];
          const b = rooms.filter((r) => r.type === rankOrder[j])[0];
          if (!a || !b) continue;
          orderDetail.push({ pair: rankOrder[i] + '/' + rankOrder[j], a: a.typeDecor, b: b.typeDecor });
          if (a.typeDecor < b.typeDecor) orderOk = false;
        }
      }
      ok(`第 ${item.floor} 层装饰密度排序（战斗>精英>秘藏>宝箱>休整）`, orderOk, orderDetail);

      // 房型专属标记
      const elite = rooms.filter((r) => r.type === 'elite')[0];
      const boss = rooms.filter((r) => r.type === 'boss')[0];
      const chest = rooms.filter((r) => r.type === 'chest')[0];
      const event = rooms.filter((r) => r.type === 'event')[0];
      ok(`第 ${item.floor} 层首领房有巨构装饰`, !!boss && boss.typeDecor > 0 && boss.flags.boss === true,
        boss ? { typeDecor: boss.typeDecor, flags: boss.flags } : null);
      ok(`第 ${item.floor} 层精英房有猩红警戒标记`, !elite || (elite.flags.elite === true && elite.typeDecor > 0),
        elite ? { typeDecor: elite.typeDecor, flags: elite.flags } : null);
      ok(`第 ${item.floor} 层宝箱房有箱台/光柱标记`, !chest || chest.flags.chest === true,
        chest ? { typeDecor: chest.typeDecor, flags: chest.flags } : null);
      ok(`第 ${item.floor} 层事件房留白（待后续）`, !event || event.typeDecor === 0,
        event ? { typeDecor: event.typeDecor } : null);
    });

    /* ---------- 三层可区分（跨层对比，不看单层"谁最高"） ---------- */
    const floorRoom = {};
    audits.forEach((a) => {
      floorRoom[a.floor] = a.audit.rooms.filter((r) => r.id === a.roomId)[0]
        || a.audit.rooms.filter((r) => r.type === 'battle')[0]
        || a.audit.rooms[0];
    });
    const rg = (r) => (r && r.meanRgb ? Number((r.meanRgb[0] / Math.max(1, r.meanRgb[1])).toFixed(3)) : 0);
    ok('三层可区分 · 符文层紫比率最高',
      !!floorRoom[2] && floorRoom[2].violetRatio > floorRoom[1].violetRatio
        && floorRoom[2].violetRatio > floorRoom[3].violetRatio,
      { f1: floorRoom[1] && floorRoom[1].violetRatio, f2: floorRoom[2] && floorRoom[2].violetRatio, f3: floorRoom[3] && floorRoom[3].violetRatio });
    ok('三层可区分 · 机械层暖色比率最高且非零',
      !!floorRoom[1] && floorRoom[1].warmRatio > 0
        && floorRoom[1].warmRatio > floorRoom[2].warmRatio
        && floorRoom[1].warmRatio > floorRoom[3].warmRatio,
      { f1: floorRoom[1] && floorRoom[1].warmRatio, f2: floorRoom[2] && floorRoom[2].warmRatio, f3: floorRoom[3] && floorRoom[3].warmRatio });
    ok('三层可区分 · R/G 排序 符文 > 机械 > 虚空',
      rg(floorRoom[2]) > rg(floorRoom[1]) && rg(floorRoom[1]) > rg(floorRoom[3]),
      { f1: rg(floorRoom[1]), f2: rg(floorRoom[2]), f3: rg(floorRoom[3]) });

    ok('avg fps ≥ 60', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
    ok('每帧耗时 ≤ 16.7ms', perf.avgFrameMs <= 16.7, { avgFrameMs: perf.avgFrameMs, maxFrameMs: perf.maxFrameMs });
    ok('贴图裁剪仍生效（只贴镜头附近一块）',
      !!perf.scenePatch && perf.scenePatch.w <= perf.view.w + 48 && perf.scenePatch.h <= perf.view.h + 48,
      perf.scenePatch);
    ok('迷雾正常（已探索房间 ≥ 1）', perf.fogSeen >= 1, { fogSeen: perf.fogSeen });
    ok('无运行时错误', Array.isArray(perf.errors) ? perf.errors.length === 0 : true, perf.errors);

    // 截图文件存在且 > 10KB
    const names = [];
    floors.forEach((f) => { names.push(`before-f${f}-battle.png`, `before-f${f}-room.png`, `after-f${f}-battle.png`, `after-f${f}-room.png`); });
    const missing = names.filter((n) => {
      const p = path.join(OUT_DIR, n);
      return !fs.existsSync(p) || fs.statSync(p).size < 10 * 1024;
    });
    ok('12 张 before/after 截图齐全且 > 10KB', missing.length === 0, missing);
  }

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nA1 ${MODE.toUpperCase()} · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(
    path.join(OUT_DIR, `a1-${MODE}-result.json`),
    JSON.stringify({ mode: MODE, passed, total: asserts.length, asserts, perf, audits }, null, 2)
  );

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
