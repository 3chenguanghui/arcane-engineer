/**
 * 骨架三变体 · 同机位 AB（只读主文件，不改源码）
 * ------------------------------------------------------------
 * 做法：固定种子生成第 1 层 → 锁死出生房 → 依次把它的形状改成
 *       rect / oct / L 三个变体（与 assignRoomTemplates 同一套字段与收缩规则），
 *       每个变体重新注册碰撞 + 重烘焙场景，然后按**同一世界矩形**裁切 sceneCanvas。
 * 为什么用裁切而不是截屏：三个变体用完全相同的世界坐标矩形取景，
 *      天然排除"相机/玩家站位/帧时机"的差别，比截屏更严格地满足"同机位"。
 * 用法：node tools/arcane_skeleton_ab.js [--seed=261108] [--floor=1]
 * 输出：.screenshots/skeleton_ab/ 下 3 张单图 + 1 张对照拼图
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9611;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'skeleton_ab');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数（种子 / 楼层）
 * @returns {{seed:string, floor:number}} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k, d) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : d;
  };
  return { seed: pick('seed', '261108'), floor: Number(pick('floor', '1')) || 1 };
}

/**
 * 启动无头 Edge 并连上 CDP
 * @returns {Promise<{ev:Function, shot:Function, close:Function}>} 探针句柄
 */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile(PORT);
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }

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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 140; i += 1) {
    await sleep(250);
    try { if (await ev(`typeof state !== 'undefined' && typeof bakeScene === 'function'`)) break; } catch (e) { /* 解析中 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/**
 * 把一个变体应用到出生房，并返回取景所需的房间矩形 + 裁切图
 * @param {Function} ev 页面求值函数
 * @param {string} shape 'rect' | 'oct' | 'L'
 * @returns {Promise<Object>} { shape, notch, cut, png }
 */
async function captureVariant(ev, shape) {
  return ev(`(() => {
    var room = state.rooms[state.spawnRoomId];
    var spans = collectRoomDoorSpans(room);
    /* 与 assignRoomTemplates 的起始房分支完全同一条路径 */
    room.shape = ${JSON.stringify(shape)};
    room.templateId = 'safe';
    room.pillars = [];
    room.cutScale = ROOM_TEMPLATE_CONFIG.safeCornerCut;
    room.lCutScaleW = ROOM_TEMPLATE_CONFIG.safeLCutW;
    room.lCutScaleH = ROOM_TEMPLATE_CONFIG.safeLCutH;
    room.lNotch = room.shape === 'L' ? pickNotchDir(room, spans).dir : 0;
    var ok = shrinkShapeToDoors(room, spans);
    if (!ok) {
      room.shape = 'rect'; room.cutScale = 0;
      room.lCutScaleW = 0; room.lCutScaleH = 0; room.lNotch = 0;
    }
    rebuildRoomWalkGeometry();
    bakeScene();
    /* 同一世界矩形取景：房心 ± 半宽半高 + 40px 余量，三个变体共用 */
    var sc = sceneScale || 1;
    var pad = 40;
    var x0 = Math.max(0, Math.round((room.x - pad) * sc));
    var y0 = Math.max(0, Math.round((room.y - pad) * sc));
    var bw = Math.min(sceneCanvas.width - x0, Math.round((room.w + pad * 2) * sc));
    var bh = Math.min(sceneCanvas.height - y0, Math.round((room.h + pad * 2) * sc));
    var c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    c.getContext('2d').drawImage(sceneCanvas, x0, y0, bw, bh, 0, 0, bw, bh);
    return {
      shape: room.shape, requested: ${JSON.stringify(shape)}, shrinkOk: ok,
      notch: room.lNotch, cutScale: room.cutScale,
      w: Math.round(room.w), h: Math.round(room.h),
      roomRect: { x: Math.round(room.x), y: Math.round(room.y), w: Math.round(room.w), h: Math.round(room.h) },
      png: c.toDataURL('image/png')
    };
  })()`);
}

/**
 * 把三张裁切图画成一张带标签的对照拼图
 * @param {Function} ev 页面求值函数
 * @param {string[]} pngs 三张 dataURL
 * @param {string[]} labels 三个标签
 * @returns {Promise<string>} 拼图 dataURL
 */
async function composeSheet(ev, pngs, labels) {
  return ev(`(async () => {
    var srcs = ${JSON.stringify(pngs)};
    var labels = ${JSON.stringify(labels)};
    var imgs = [];
    for (var i = 0; i < srcs.length; i += 1) {
      var im = new Image();
      im.src = srcs[i];
      await new Promise(function(res){ im.onload = res; });
      imgs.push(im);
    }
    var cw = 560, ch = Math.round(cw * imgs[0].height / imgs[0].width);
    var pad = 12, top = 46;
    var cvs = document.createElement('canvas');
    cvs.width = cw * 3 + pad * 4;
    cvs.height = ch + top + pad * 2;
    var g = cvs.getContext('2d');
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, cvs.width, cvs.height);
    g.fillStyle = '#e8e2d4'; g.font = 'bold 18px "Microsoft YaHei", sans-serif';
    g.fillText('骨架三变体 · 同一出生房 · 同机位裁切', pad, 29);
    imgs.forEach(function(im, i){
      var x = pad + i * (cw + pad);
      g.drawImage(im, x, top, cw, ch);
      g.fillStyle = '#9aa3ad'; g.font = '13px "Microsoft YaHei", sans-serif';
      g.fillText(labels[i], x + 4, top + ch + 16);
    });
    return cvs.toDataURL('image/png');
  })()`);
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  const { seed, floor } = parseArgs();
  const h = await boot();
  try {
    const boot = await h.ev(`(() => {
      state.seedInfo = { active: true, value: ${JSON.stringify(seed)}, daily: false, custom: true, startedAt: 0 };
      __rngOverride = null;
      __roamDebug.setFloor(${floor});
      state.mode = 'playing'; state.status = 'playing';
      __rngOverride = null;
      __roamDebug.despawnAll();
      var room = state.rooms[state.spawnRoomId];
      __roamDebug.teleport(room.cx, room.cy);
      return { floor: state.floor, rooms: state.rooms.length, spawn: room.id,
               spawnType: room.type, shape: room.shape, seed: state.seedInfo.value };
    })()`);
    console.log('开局', JSON.stringify(boot));

    const variants = ['rect', 'oct', 'L'];
    const shots = [];
    for (const v of variants) {
      const r = await captureVariant(h.ev, v);
      const file = path.join(OUT, `spawn-${v}.png`);
      fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
      shots.push({ ...r, png: r.png });
      console.log(`变体 ${v} → 实际 ${r.shape}（收缩 ${r.shrinkOk ? '通过' : '降级'}，缺口 ${r.notch}，切角 ${r.cutScale}，${r.w}×${r.h}）→ ${file}`);
    }

    const labels = shots.map((s) => `${s.requested} → ${s.shape} · ${s.w}×${s.h}`);
    const sheet = await composeSheet(h.ev, shots.map((s) => s.png), labels);
    const sheetFile = path.join(OUT, 'skeleton-ab-sheet.png');
    fs.writeFileSync(sheetFile, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log('对照拼图 → ' + sheetFile);
  } finally {
    h.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
