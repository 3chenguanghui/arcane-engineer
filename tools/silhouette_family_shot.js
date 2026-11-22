/**
 * P3 肉眼验收图探针（只读，不改游戏文件）
 * ------------------------------------------------------------
 * 目的：把"同族 10 只怪同时摆在一间房里"截成一张整帧去色的图，
 *       让验收人能用眼睛数出 10 个不同轮廓（不靠 JSON 数字）。
 *
 * 做法：
 *   1) 固定种子 SILFAM，generateFloor(1)，取面积最大的一间房当"展厅"；
 *   2) 把玩家放在房心（相机跟随玩家），怪物摆成 5×2 网格、整体抬到玩家上方，
 *      避免玩家本体挡住怪；
 *   3) 三个族各来一张：机械 / 符文 / 虚空，每族 10 只、body 各不相同（与 SILHOUETTE_ROSTER 对齐）；
 *   4) 整帧去色（canvas 上挂 grayscale(1)），并临时隐藏 HUD 浮层，画面里只剩房间与怪；
 *   5) 截图后记录每只怪的 id / body / 世界坐标 / 500ms 后的位移（证明它们没跑散）。
 *
 * 用法：node tools/silhouette_family_shot.js [html路径] [tag]
 * 输出：.screenshots/firstplay/silhouette-family-<family>-<tag>.png
 *       .screenshots/firstplay/silhouette-family-<tag>.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const TAG = process.argv[3] || 'final';
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 建连并打开游戏页（与 nav_compare.js 同一套无头 Edge 启动方式）
 * @returns {Promise<Object>} CDP 会话
 */
async function connect() {
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 5 && !target; attempt += 1) {
    const port = 10760 + Math.floor(Math.random() * 120);
    const profile = prepareProfile();
    edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--allow-file-access-from-files', '--window-size=1440,900', '--force-device-scale-factor=1',
      'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !target; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page') || null;
      } catch (e) { /* 等端口 */ }
      if (!target) await sleep(250);
    }
    if (!target) { try { killEdge(edge); } catch (e) { /* 忽略 */ } await sleep(300); }
  }
  if (!target) throw new Error('调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || '') };
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) {
      const c = { x: Number(clip.x), y: Number(clip.y), width: Number(clip.width), height: Number(clip.height), scale: 1 };
      if (![c.x, c.y, c.width, c.height].every((v) => Number.isFinite(v)) || c.width <= 0 || c.height <= 0) {
        throw new Error('bad-clip ' + name + ' ' + JSON.stringify(clip));
      }
      params.clip = c;
    }
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, shot };
}

/**
 * 摆怪 + 去色的注入表达式
 * @param {string} family 'mech' | 'rune' | 'void'
 * @returns {string} 可注入 Runtime.evaluate 的表达式
 */
function setupExpr(family) {
  return `(function(){
    var FAM = {
      mech: ['assembler','welder','patrol','riveter','crawler','forge','magtractor','gearsplit','steamjet','geargrind'],
      rune: ['sprite','graveter','hexer','cipher','warden','sigilweaver','mirrorghost','chanter','platewright','mirrorphantom'],
      void: ['stalker','shard','maw','riftling','screamer','bishop','siphon','warper','coalescer','voidconduit']
    };
    var bodies = FAM['${family}'];
    /* 每个 body 对应唯一一只怪：从 ENEMY_CONFIG 里反查 id，保证摆出来的是"真实本族十款" */
    var picked = bodies.map(function(b){
      var c = ENEMY_CONFIG.filter(function(x){ return x.body === b; })[0];
      return c ? { id: c.id, body: c.body } : { id: null, body: b };
    });
    var missing = picked.filter(function(p){ return !p.id; }).map(function(p){ return p.body; });

    /* 固定种子 + 取最大房间当展厅。
       用第 2 层：第 1 层带新手训练浮层，会压住画面中心，不适合当验收图。 */
    state.seedInfo = { active: true, value: 'SILFAM' };
    generateFloor(2);
    var room = null;
    (state.rooms || []).forEach(function(r){ if (!room || r.w * r.h > room.w * room.h) room = r; });

    state.enemies = [];
    state.projectiles = []; state.bullets = []; state.rings = [];
    /* 玩家站到房心偏下 110px：相机跟着玩家，十只怪就整体落在画面上半部，
       裁剪时可以把玩家本体裁掉（否则他会混进去当第 11 个轮廓）。 */
    state.player.x = room.cx; state.player.y = room.cy + 110;
    state.player.vx = 0; state.player.vy = 0;
    state.player.hp = state.player.hpMax;
    /* 不手动写 seenRooms、也不手动调 revealRoom：
       ① 迷雾是离屏遮罩，只有 fogReady 之后 carveFogRect 才擦得动，提前调是空操作；
       ② 先把 seenRooms 置 true 会骗过游戏自己的"首次进房"判断（isNew=false），
          结果它也不会再擦 —— 房间就一直是黑的。
       正确做法：只把人放进去，让 updateRoomLogic 自己跑一次进房揭示（下面会等 2.5s）。 */
    state.currentRoomId = room.id;
    if (state.roomEntry) state.roomEntry.lastRoomId = room.id;

    /* 5 列 × 2 行，放在玩家上方 140–260px，裁剪时玩家会被排在框外 */
    var cols = 5, gapX = 118, gapY = 120;
    var startX = room.cx - gapX * 2;
    var startY = room.cy - 150;
    var spawned = [];
    picked.forEach(function(p, i){
      if (!p.id) return;
      var col = i % cols, row = Math.floor(i / cols);
      var x = startX + col * gapX, y = startY + row * gapY;
      var e = spawnEnemy(p.id, x, y, 1, {});
      /* 静止：把速度清零，防止 500ms 内挤成一团（位移会写进 JSON 供核对） */
      e.speed = 0; e.vx = 0; e.vy = 0; e.fireTimer = 999; e.blinkTimer = 999;
      e.hp = e.hpMax;
      spawned.push({ id: p.id, body: p.body, x: Math.round(x), y: Math.round(y), ref: e });
    });

    /* 相机立刻贴到玩家（无头 rAF 3–4fps，lerp 会漂） */
    if (typeof GAME_CONFIG !== 'undefined' && !window.__silCamBackup) {
      window.__silCamBackup = GAME_CONFIG.camLerp;
      GAME_CONFIG.camLerp = 1000;
    }
    if (typeof snapCamera === 'function') snapCamera();

    /* 隐藏除画布外的全部 DOM 浮层（HUD、顶栏、教程卡…），只留房间与怪，方便数轮廓。
       HUD 与画布是兄弟节点、各自嵌套很深，所以不能按 body 子节点筛；
       这里把"不在 #game 祖先链上"的元素全部 visibility:hidden，画布本身不受影响。 */
    var cv = document.getElementById('game');
    var keep = [];
    for (var n = cv; n; n = n.parentElement) keep.push(n);
    Array.prototype.forEach.call(document.querySelectorAll('body *'), function(el){
      if (keep.indexOf(el) >= 0) return;
      el.style.setProperty('visibility', 'hidden', 'important');
    });

    window.__silRefs = spawned.map(function(s){ return s.ref; });
    /* 手动渲染一帧：无头环境 rAF 只有 3–4fps，且换层后可能还在过渡态，
       等 rAF 不保险，直接同步画一帧，截图就不会抓到空画面。 */
    var drewOk = true;
    try { render(); } catch (err) { drewOk = String(err && err.message || err); }
    return { mode: state.mode, drewOk: drewOk, room: { id: room.id, x: Math.round(room.x), y: Math.round(room.y),
        w: Math.round(room.w), h: Math.round(room.h), cx: Math.round(room.cx), cy: Math.round(room.cy) },
      zoom: Number(cameraZoom().toFixed(3)),
      cam: { x: Math.round(state.cam.x), y: Math.round(state.cam.y) },
      canvas: (function(){ var b = cv.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height, pxW: cv.width, pxH: cv.height }; })(),
      picked: picked, missing: missing,
      spawned: spawned.map(function(s){ return { id: s.id, body: s.body, x: s.x, y: s.y }; }) };
  })()`;
}

/**
 * 读取 500ms 后的实际位置，确认"怪没跑散"
 * @returns {string} 可注入 Runtime.evaluate 的表达式
 */
const driftExpr = `(function(){
  var refs = window.__silRefs || [];
  return refs.map(function(e){
    return { id: e.typeId, body: e.body, x: Math.round(e.x), y: Math.round(e.y) };
  });
})()`;

/**
 * 主流程：开局 → 逐族摆怪 → 截图 → 落 JSON
 */
async function main() {
  const { edge, ws, send, ev, shot } = await connect();
  const report = { file: FILE, tag: TAG, startedAt: new Date().toISOString(), families: {} };
  try {
  /* 设备像素比 2：画布按 2× 内部分辨率绘制，截图输出也是 2×，
     这样单只怪在成品图里约 50px 高，轮廓能看清、数得清。 */
  const VIEW = { w: 1410, h: 805 };
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.w, height: VIEW.h, deviceScaleFactor: 2, mobile: false,
    screenWidth: VIEW.w, screenHeight: VIEW.h
  });
  await send('Page.navigate', { url: pathToFileURL(FILE).href });
  await sleep(2500);
    await ev(`document.getElementById('btnStart').click()`);
    await sleep(350);
    await ev(`document.querySelector('#charGrid .char-card').click()`);
    await sleep(200);
    await ev(`document.getElementById('btnCharConfirm').click()`);
    for (let i = 0; i < 40; i += 1) { if ((await ev(`state.mode`)) === 'playing') break; await sleep(100); }
    await sleep(400);
    /* 前五层默认带新手训练浮层，会挡住画面中心；验收图不需要，直接跳过 */
    await ev(`(function(){ var b = document.getElementById('tutSkip'); if (b) { b.click(); return 'skipped'; } return 'no-tut'; })()`);
    await sleep(300);

    for (const family of ['mech', 'rune', 'void']) {
      const setup = await ev(setupExpr(family));
      if (setup && setup.__err) { report.families[family] = { error: setup.__err }; continue; }
      await sleep(4200);
      const drift = await ev(driftExpr);
      /* 截图前收尾：①同步渲染一帧 ②整帧去色（saturation 混合铺中性灰）③冻结 render，
         避免 rAF 在"去色"和"截图"之间又画一帧彩色的把去色覆盖掉。
         不用 CSS filter：无头 Edge 里 canvas 挂 filter 后多次重绘会丢合成层，实测会截出黑屏。 */
      const freeze = await ev(`(function(){
        try {
          /* 进房可能触发房间刷怪：只留下我们摆的这 10 只，保证画面里正好 10 个轮廓 */
          var refs = window.__silRefs || [];
          state.enemies = (state.enemies || []).filter(function(e){ return refs.indexOf(e) >= 0; });
          state.projectiles = []; state.bullets = [];
          render();
          var c = document.getElementById('game'), g = c.getContext('2d');
          g.save();
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.globalCompositeOperation = 'saturation';
          g.fillStyle = '#808080';
          g.fillRect(0, 0, c.width, c.height);
          g.restore();
          window.__silOrigRender = render;
          render = function(){};
          return 'frozen';
        } catch (e) { return String(e); }
      })()`);
      await sleep(200);
      const cv = setup.canvas;
      /* 只截"十只怪 + 留白"这一块（CSS 像素坐标；设备像素比 2 时输出会自动放大一倍），
         房间其余空地和相邻房间不进来，图更干净、怪更大。 */
      const z = setup.zoom;
      const pts = setup.spawned.map((u) => ({
        x: (u.x - setup.cam.x) * z,
        y: (u.y - setup.cam.y) * z
      }));
      const pad = 95;
      const padBottom = 55; /* 下沿多收一点，把画面底部的玩家本体裁掉 */
      const x0 = Math.max(0, Math.min(...pts.map((p) => p.x)) - pad);
      const y0 = Math.max(0, Math.min(...pts.map((p) => p.y)) - pad);
      const x1 = Math.min(cv.width, Math.max(...pts.map((p) => p.x)) + pad);
      const y1 = Math.min(cv.height, Math.max(...pts.map((p) => p.y)) + padBottom);
      const crop = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      await shot(`silhouette-family-${family}-${TAG}.png`, crop);
      /* 解冻：下一族还要继续画 */
      await ev(`(function(){ if (window.__silOrigRender) render = window.__silOrigRender; return true; })()`);
      const maxDrift = Math.max(0, ...drift.map((d) => {
        const orig = setup.spawned.find((s) => s.body === d.body && s.id === d.id);
        return orig ? Math.hypot(d.x - orig.x, d.y - orig.y) : 0;
      }));
      report.families[family] = {
        mode: setup.mode, setupRender: setup.drewOk, freeze: freeze,
        room: setup.room, zoom: setup.zoom, cam: setup.cam, canvas: cv,
        missingBodies: setup.missing, spawnCount: setup.spawned.length,
        maxDrift500ms: Number(maxDrift.toFixed(1)),
        units: drift,
        image: `silhouette-family-${family}-${TAG}.png`
      };
      console.log(`${family}: ${setup.spawned.length}/10 只, maxDrift=${maxDrift.toFixed(1)}px, 房间 ${setup.room.w}×${setup.room.h}`);
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, `silhouette-family-${TAG}.json`), JSON.stringify(report, null, 2));
    console.log('已写出:', path.join(OUT, `silhouette-family-${TAG}.json`));
  } finally {
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(edge); } catch (e) { /* 忽略 */ }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
