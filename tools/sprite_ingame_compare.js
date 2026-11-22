/**
 * 真机贴地验收探针（只读游戏文件，不写 index_arcane_v2.html）
 * ------------------------------------------------------------
 * 目的：把建模线交付的三套 3D sprite 真的贴进游戏房间地面，
 *       在真实地砖 / 真实光照 / 真实背景下截图，并给出像素级实测。
 *
 * 做法：
 *   1) 无头 Edge 打开游戏 → 开局 → 固定种子生成第 1 层；
 *   2) 关掉主循环（crashState.halted=true），相机定格在同一格地砖上；
 *   3) 用游戏自己的 drawPlayer / drawRegionEnemy 在离屏画布导出"旧画法"本体
 *      （剪影模式，正面朝南，和 sprite 表的第 2 行 S 对齐）；
 *   4) 用 overlay 画布按游戏相机变换（world→screen）把 spun 贴到地砖锚点；
 *   5) 截图 + 统计不透明像素、包围盒、明度/饱和度、与地面的对比、脚底接触暗度。
 *
 * 用法：node tools/sprite_ingame_compare.js
 * 输出：.screenshots/firstplay/sprite-*.png + sprite-ingame.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const SPRITES = path.join(ROOT, 'sprites', 'out');
const OUT = path.join(ROOT, '.screenshots', 'firstplay');
const MODE = process.argv[2] || 'start';   // start = 出生房（安全房，偏亮）；combat = 战斗房
const TAG = 'sprite-' + MODE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把本地 png 读成 data URL，避免 file:// 画布污染导致 getImageData 失败 */
function dataUrl(file) {
  return 'data:image/png;base64,' + fs.readFileSync(path.join(SPRITES, file)).toString('base64');
}

/**
 * 建连并打开游戏页（沿用 select_probe.js 的无头 Edge 启动方式）
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
  /** 截取锚点附近区域（clip 只截画面，不参与像素统计） */
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 2 };
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  return { edge, ws, send, ev, shot };
}

/**
 * 页面内工具：加载图片 / 量 alpha 包围盒 / 画 overlay / 统计像素
 * 全部挂到 window.__SP，后续每一步都用 Runtime.evaluate 调用
 */
const PAGE_TOOL = `(function(){
  // 同时挂到 window.SP，后续每次 Runtime.evaluate 都能直接引用
  const SP = window.SP = window.__SP = { imgs: {}, meta: {} };
  /** 把 data URL 加载成 Image */
  SP.load = function(key, url){
    return new Promise(function(res, rej){
      const im = new Image();
      im.onload = function(){ SP.imgs[key] = im; res({ key: key, w: im.width, h: im.height }); };
      im.onerror = function(){ rej(new Error('load fail ' + key)); };
      im.src = url;
    });
  };
  /** 量某块源区域的不透明包围盒（alpha>8） */
  SP.bbox = function(key, sx, sy, sw, sh){
    const im = SP.imgs[key];
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const g = c.getContext('2d');
    g.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
    const d = g.getImageData(0, 0, sw, sh).data;
    let x0 = sw, y0 = sh, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        if (d[(y * sw + x) * 4 + 3] > 8) {
          n += 1;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0 + 1, h: y1 - y0 + 1, px: n };
  };
  /** 取游戏画布的当前帧（含地砖/墙/光照/迷雾，作为"地面底图"） */
  SP.base = function(){
    const cv = document.getElementById('game');
    const g = cv.getContext('2d');
    SP.baseData = g.getImageData(0, 0, cv.width, cv.height).data;
    SP.baseW = cv.width; SP.baseH = cv.height;
    return { w: cv.width, h: cv.height };
  };
  /** 建 overlay 画布（盖在游戏上，不接管事件） */
  SP.overlay = function(){
    let c = document.getElementById('__spriteOverlay');
    if (!c) {
      c = document.createElement('canvas');
      c.id = '__spriteOverlay';
      c.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:9999;';
      document.body.appendChild(c);
    }
    c.width = window.innerWidth; c.height = window.innerHeight;
    c.style.width = window.innerWidth + 'px'; c.style.height = window.innerHeight + 'px';
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    return c;
  };
  /** 清空 overlay */
  SP.clear = function(){ SP.overlay(); return true; };
  /**
   * 在 overlay 上画一个单位
   * cfg = { kind:'new'|'old', key, k, row, wx, wy, feet } 
   *   wx,wy = 世界坐标；feet = 该让"脚底"落在哪（世界 y 由 wy 表示，这里用 wx,wy 就是脚底点）
   */
  SP.drawUnit = function(cfg){
    const g = document.getElementById('__spriteOverlay').getContext('2d');
    const z = cameraZoom();
    const sx = (cfg.wx - state.cam.x) * z;
    const sy = (cfg.wy - state.cam.y) * z;
    const im = SP.imgs[cfg.key];
    if (cfg.kind === 'old') {
      // 旧画法导出图：256×256，单位原点在 (128,128)；用实测 alpha 底边当脚底
      const b = SP.meta[cfg.key].bbox;
      const scale = z; // 旧画法是 1:1 世界像素
      g.drawImage(im, 0, 0, 256, 256,
        sx - 128 * scale, sy - b.y1 * scale, 256 * scale, 256 * scale);
    } else {
      const cell = 160, ax = 80;
      const b = SP.meta[cfg.key + '@' + cfg.row].bbox;
      const scale = cfg.k * z;
      g.drawImage(im, 0, cfg.row * cell, cell, cell,
        sx - ax * scale, sy - b.y1 * scale, cell * scale, cell * scale);
    }
    return { sx: sx, sy: sy, z: z };
  };
  /**
   * 只画一个单位并统计像素（用于"同一格"逐项对比）
   * cfg = { kind, key, k, row, wx, wy }
   */
  SP.measure = function(cfg){
    SP.overlay();
    SP.drawUnit(cfg);
    const c = document.getElementById('__spriteOverlay');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const W = c.width;
    let x0 = W, y0 = c.height, x1 = -1, y1 = -1;
    let solid = 0, cov = 0, sumL = 0, sumS = 0, sumLfloor = 0, sumContrast = 0, n = 0;
    const lum = function(r, gg, b){ return 0.2126 * r + 0.7152 * gg + 0.0722 * b; };
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a <= 8) continue;
      const p = i / 4, x = p % W, y = (p - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      cov += a / 255;
      if (a >= 128) {
        solid += 1;
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        sumL += lum(r, gg, b);
        sumS += mx === 0 ? 0 : (mx - mn) / mx;
        const bi = i;
        const fl = lum(SP.baseData[bi], SP.baseData[bi + 1], SP.baseData[bi + 2]);
        sumLfloor += fl;
        sumContrast += Math.abs(lum(r, gg, b) - fl);
        n += 1;
      }
    }
    const bboxW = x1 - x0 + 1, bboxH = y1 - y0 + 1;
    /* 脚底带：包围盒最下 4 行里的不透明像素，和同一批像素的地面亮度做差。
       delta < 0 = 最低处比地面更暗（有接触阴影/暗脚），> 0 = 比地面更亮（发飘） */
    let bSum = 0, bFloor = 0, bN = 0;
    for (let y = Math.max(0, y1 - 3); y <= y1; y += 1) {
      for (let x = Math.max(0, x0); x <= x1; x += 1) {
        const i = (y * W + x) * 4;
        if (d[i + 3] < 128) continue;
        bSum += lum(d[i], d[i + 1], d[i + 2]);
        bFloor += lum(SP.baseData[i], SP.baseData[i + 1], SP.baseData[i + 2]);
        bN += 1;
      }
    }
    const z = cameraZoom();
    const below = SP.contact(x0, x1, y1);
    return {
      key: cfg.key, kind: cfg.kind, k: cfg.k || null, row: cfg.row == null ? null : cfg.row,
      bbox: { x: x0, y: y0, w: bboxW, h: bboxH, bottom: y1 },
      screenW: bboxW, screenH: bboxH,
      solidPx: solid, covPx: Math.round(cov), fill: +(solid / (bboxW * bboxH)).toFixed(3),
      tilesW: +(bboxW / (64 * z)).toFixed(2), tilesH: +(bboxH / (64 * z)).toFixed(2),
      meanL: +(sumL / n).toFixed(1), meanS: +(sumS / n).toFixed(3),
      floorL: +(sumLfloor / n).toFixed(1), contrastDL: +(sumContrast / n).toFixed(1),
      feetBottom: y1, contact: below,
      footBand: bN ? { spriteL: +(bSum / bN).toFixed(1), floorL: +(bFloor / bN).toFixed(1),
        delta: +((bSum - bFloor) / bN).toFixed(1) } : null
    };
  };
  /** 脚底接触暗度：脚底下一窄条 vs 两侧对照条的平均亮度差 */
  SP.contact = function(x0, x1, feetY){
    const W = SP.baseW;
    const band = function(ax0, ax1, ay0, ay1){
      let s = 0, c = 0;
      for (let y = Math.max(0, ay0); y <= Math.min(SP.baseH - 1, ay1); y += 1) {
        for (let x = Math.max(0, ax0); x <= Math.min(W - 1, ax1); x += 1) {
          const i = (y * W + x) * 4;
          s += 0.2126 * SP.baseData[i] + 0.7152 * SP.baseData[i + 1] + 0.0722 * SP.baseData[i + 2];
          c += 1;
        }
      }
      return c ? s / c : 0;
    };
    const cx = Math.round((x0 + x1) / 2);
    const under = band(cx - 12, cx + 12, feetY - 2, feetY + 6);
    const left = band(x0 - 34, x0 - 12, feetY - 2, feetY + 6);
    const right = band(x1 + 12, x1 + 34, feetY - 2, feetY + 6);
    return { underL: +under.toFixed(1), sideL: +((left + right) / 2).toFixed(1),
      delta: +(((left + right) / 2) - under).toFixed(1) };
  };
  /** 导出旧画法本体（剪影模式，正面朝南），256×256，原点在中心 */
  SP.exportOld = function(key){
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    const prev = ctx;
    ctx = g;
    g.save();
    g.translate(128, 128);
    try {
      if (key === 'player') {
        const p = state.player;
        const ox = p.x, oy = p.y, of = p.facingAngle;
        state._silhouettePass = true;
        p.x = 0; p.y = 0; p.facingAngle = Math.PI / 2;   // 朝南 = 正面，对齐 sprite 第 2 行
        // 注意：进入截图阶段后 drawPlayer 被临时置空，这里必须走备份引用
        try { (window.__dp || drawPlayer)(); } finally {
          state._silhouettePass = false;
          p.x = ox; p.y = oy; p.facingAngle = of;
        }
      } else {
        const conf = ENEMY_CONFIG.find(function(i){ return i.id === key; });
        const fake = {
          id: 1, typeId: conf.id, radius: conf.radius, color: conf.color, accent: conf.accent,
          art: conf.art, body: conf.body, ai: conf.ai, facing: Math.PI / 2, wobble: 0,
          flash: 0, squash: 0, squashAngle: 0, windup: 0, windupScale: 0,
          fireTimer: 99, hitCooldown: 0, fireInterval: conf.fireInterval || 2,
          blinker: 99, blinkTimer: 99, shieldHp: 0, frozenTime: 0, slowTime: 0,
          hp: 10, hpMax: 10, elite: false, affix: null
        };
        if (fake.art) drawRegionEnemy(fake, 0);
        else if (fake.typeId === 'wanderer') drawWispEnemy(fake, 0);
        else if (fake.typeId === 'shooter') drawTurretEnemy(fake, 0);
        else drawPhaserEnemy(fake, 0, 0);
      }
    } finally {
      g.restore();
      ctx = prev;
    }
    return c.toDataURL('image/png');
  };
  return { ok: true, z: cameraZoom(), view: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio } };
})()`;

/**
 * 主流程
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { edge, ws, send, ev, shot } = await connect();
  const report = { file: FILE, at: new Date().toISOString(), units: {} };
  try {
    await send('Page.navigate', { url: pathToFileURL(FILE).href });
    for (let i = 0; i < 80; i += 1) {
      const ok = await ev(`(function(){ var t=document.getElementById('titleLayer'); return document.readyState==='complete' && typeof state!=='undefined' && !!t && !t.classList.contains('hidden'); })()`);
      if (ok) break;
      await sleep(200);
    }
    await ev(`document.getElementById('btnStart').click()`);
    await sleep(350);
    await ev(`document.querySelector('#charGrid .char-card').click()`);
    await sleep(200);
    await ev(`document.getElementById('btnCharConfirm').click()`);
    for (let i = 0; i < 40; i += 1) { if ((await ev(`state.mode`)) === 'playing') break; await sleep(100); }
    await sleep(500);
    await ev(`(function(){ state.seedInfo = { active: true, value: 'SPRITEPROBE' }; generateFloor(1); return state.floor; })()`);
    await sleep(500);

    const tool = await ev(PAGE_TOOL);
    if (tool && tool.__err) throw new Error('页面工具注入失败: ' + tool.__err);
    report.view = tool.view;
    report.camZoom = tool.z;

    // ---- 定格：相机对准目标房中心的一格地砖，关掉主循环 ----
    const stage = await ev(`(function(){
      const z = cameraZoom();
      const rooms = state.rooms;
      let room = rooms[state.spawnRoomId] || rooms[0];
      if (${JSON.stringify(MODE)} === 'combat') {
        room = rooms.find(function(r){ return /battle|combat|fight|elite/i.test(String(r.type)); })
          || rooms.find(function(r){ return r.id !== state.spawnRoomId; }) || room;
      }
      // 目标房设为已探索 + 当前焦点房，保证迷雾与"焦点拉亮"都是真实状态
      // 必须走引擎自己的 revealRoom：它在迷雾层上擦出房间矩形，只写 seenRooms 房间仍是黑的
      if (typeof revealRoom === 'function') revealRoom(room, true);
      else state.fog.seenRooms[room.id] = true;
      room.visited = true;
      // 怪移出画面：只留地面，避免遮挡；update 已停，不会再动
      (state.enemies || []).forEach(function(e){ e.x = -99999; e.y = -99999; });
      // 对齐到房间自己的 64px 地砖格中心
      const tx = room.x + Math.floor((room.cx - room.x) / 64) * 64 + 32;
      const ty = room.y + Math.floor((room.cy - room.y) / 64) * 64 + 32;
      state.player.x = tx; state.player.y = ty;
      state.player.walkBlend = 0; state.player.castAnim = 0;
      const vw = state.viewW || window.innerWidth, vh = state.viewH || window.innerHeight;
      state.cam.x = tx - vw / (2 * z);
      state.cam.y = ty - vh * 0.56 / z;
      crashState.halted = true;           // 停 update + render，动作完全定格
      render();                            // 手动渲染一帧
      window.__dp = drawPlayer;
      window.__dc = drawCrosshair;
      drawPlayer = function(){};           // 隐藏本局玩家本体，避免和贴图重叠
      drawCrosshair = function(){};        // 隐藏准星，避免压在被测精灵上
      render();
      return { z: z, room: { id: room.id, type: room.type, x: Math.round(room.x), y: Math.round(room.y),
        w: Math.round(room.w), h: Math.round(room.h) }, anchor: { x: tx, y: ty },
        cam: { x: Math.round(state.cam.x), y: Math.round(state.cam.y) },
        rooms: rooms.map(function(r){ return { id: r.id, type: r.type }; }) };
    })()`);
    if (stage && stage.__err) throw new Error('定格失败: ' + stage.__err);
    report.stage = stage;
    await sleep(200);

    const base = await ev(`(function(){ var r = SP.base(); return r; })()`);
    report.base = base;
    // 无贴图的纯场景底图（用于肉眼确认"地砖/光照是真实的"）
    const z = stage.z;
    const anchorSX = (stage.anchor.x - stage.cam.x) * z;
    const anchorSY = (stage.anchor.y - stage.cam.y) * z;
    const clip = { x: Math.max(0, anchorSX - 300), y: Math.max(0, anchorSY - 240), width: 600, height: 330 };
    await shot(TAG + '-00-base.png', clip);

    // ---- 加载三张 sheet + 导出三份旧画法 ----
    for (const [key, file] of [['hero', 'hero_sheet.png'], ['mech', 'mech_sheet.png'], ['rune', 'rune_sheet.png']]) {
      const r = await ev(`SP.load(${JSON.stringify(key)}, ${JSON.stringify(dataUrl(file))})`);
      if (r && r.__err) throw new Error('加载失败 ' + key + ': ' + r.__err);
    }
    for (const [key, id] of [['old_player', 'player'], ['old_mech', 'assembler'], ['old_rune', 'graveter']]) {
      const url = await ev(`SP.exportOld(${JSON.stringify(id)})`);
      if (typeof url === 'string' && url.startsWith('data:image')) {
        const r = await ev(`SP.load(${JSON.stringify(key)}, ${JSON.stringify(url)})`);
        if (r && r.__err) throw new Error('旧画法加载失败 ' + key + ': ' + r.__err);
      } else {
        throw new Error('旧画法导出失败 ' + key + ': ' + JSON.stringify(url));
      }
    }

    // ---- 量包围盒：旧 256 图；新每张表第 2 行（S 正面）的 idle 格 ----
    const meta = await ev(`(function(){
      const out = {};
      ['old_player','old_mech','old_rune'].forEach(function(k){
        out[k] = { bbox: SP.bbox(k, 0, 0, 256, 256) };
      });
      [['hero','old_player'],['mech','old_mech'],['rune','old_rune']].forEach(function(p){
        const k = p[0];
        out[k + '@2'] = { bbox: SP.bbox(k, 0, 2 * 160, 160, 160) };
      });
      return out;
    })()`);
    if (meta && meta.__err) throw new Error('量包围盒失败: ' + meta.__err);
    await ev(`(function(){ SP.meta = ${JSON.stringify(meta)}; return true; })()`);
    report.meta = meta;

    // ---- 每行（8 方位）包围盒：验证"单一 k 只能匹配一个朝向" ----
    const rows = await ev(`(function(){
      const o = {};
      ['hero','mech','rune'].forEach(function(k){
        o[k] = [];
        for (let r = 0; r < 8; r += 1) o[k].push(SP.bbox(k, 0, r * 160, 160, 160));
      });
      return o;
    })()`);
    if (rows && rows.__err) throw new Error('量每行包围盒失败: ' + rows.__err);
    report.rows = rows;

    // 规格系数（高度对齐）+ §3 备选系数（宽度对齐）
    const UNIT_DEF = [
      { key: 'hero', old: 'old_player', label: '主角', kH: 0.533, kW: 76 / 63 },
      { key: 'mech', old: 'old_mech', label: '机械族', kH: 0.425, kW: 76 / 78 },
      { key: 'rune', old: 'old_rune', label: '符文族', kH: 0.549, kW: 52 / 45 }
    ];

    for (const u of UNIT_DEF) {
      const astate = await ev(`(function(){
        // 三个锚点：同一行地砖，间隔 110 世界像素（并排用）
        const a = ${JSON.stringify(stage.anchor)};
        return { a: a, b: { x: a.x + 110, y: a.y }, c: { x: a.x + 220, y: a.y } };
      })()`);

      // --- 图 1：并排（旧 / 高度对齐 / 宽度对齐），脚底同一水平线 ---
      await ev(`(function(){
        SP.overlay();
        SP.drawUnit({ kind:'old', key:${JSON.stringify(u.old)}, wx:${astate.a.x}, wy:${astate.a.y} });
        SP.drawUnit({ kind:'new', key:${JSON.stringify(u.key)}, k:${u.kH}, row:2, wx:${astate.b.x}, wy:${astate.b.y} });
        SP.drawUnit({ kind:'new', key:${JSON.stringify(u.key)}, k:${u.kW}, row:2, wx:${astate.c.x}, wy:${astate.c.y} });
        return true;
      })()`);
      await sleep(120);
      const clipSide = { x: Math.max(0, anchorSX - 60), y: Math.max(0, anchorSY - 240), width: 620, height: 330 };
      await shot(`${TAG}-${u.key}-side.png`, clipSide);

      // --- 图 2/3：同一格，单独贴（高度对齐 / 宽度对齐） ---
      await ev(`(function(){ SP.clear();
        SP.drawUnit({ kind:'new', key:${JSON.stringify(u.key)}, k:${u.kH}, row:2, wx:${astate.a.x}, wy:${astate.a.y} });
        return true; })()`);
      await sleep(120);
      await shot(`${TAG}-${u.key}-height.png`, clip);

      await ev(`(function(){ SP.clear();
        SP.drawUnit({ kind:'new', key:${JSON.stringify(u.key)}, k:${u.kW}, row:2, wx:${astate.a.x}, wy:${astate.a.y} });
        return true; })()`);
      await sleep(120);
      await shot(`${TAG}-${u.key}-width.png`, clip);

      // --- 图 4：旧画法单独在同一格（做并排的"同一格"证据） ---
      await ev(`(function(){ SP.clear();
        SP.drawUnit({ kind:'old', key:${JSON.stringify(u.old)}, wx:${astate.a.x}, wy:${astate.a.y} });
        return true; })()`);
      await sleep(120);
      await shot(`${TAG}-${u.key}-old.png`, clip);

      // --- 像素实测（每次只画一个，同一锚点） ---
      const mOld = await ev(`SP.measure({ kind:'old', key:${JSON.stringify(u.old)}, wx:${astate.a.x}, wy:${astate.a.y} })`);
      const mH = await ev(`SP.measure({ kind:'new', key:${JSON.stringify(u.key)}, k:${u.kH}, row:2, wx:${astate.a.x}, wy:${astate.a.y} })`);
      const mW = await ev(`SP.measure({ kind:'new', key:${JSON.stringify(u.key)}, k:${u.kW}, row:2, wx:${astate.a.x}, wy:${astate.a.y} })`);
      report.units[u.key] = { label: u.label, old: mOld, height: mH, width: mW };
      await ev(`SP.clear()`);
    }

    // ---- 三族同框（判断"同一个世界观"） ----
    await ev(`(function(){
      SP.overlay();
      const a = ${JSON.stringify(stage.anchor)};
      SP.drawUnit({ kind:'new', key:'hero', k:0.533, row:2, wx:a.x - 90, wy:a.y });
      SP.drawUnit({ kind:'new', key:'mech', k:0.425, row:2, wx:a.x + 10, wy:a.y });
      SP.drawUnit({ kind:'new', key:'rune', k:0.549, row:2, wx:a.x + 110, wy:a.y });
      return true;
    })()`);
    await sleep(150);
    await shot(TAG + '-01-trio-new.png', { x: Math.max(0, anchorSX - 200), y: Math.max(0, anchorSY - 220), width: 520, height: 300 });

    await ev(`(function(){
      SP.overlay();
      const a = ${JSON.stringify(stage.anchor)};
      SP.drawUnit({ kind:'old', key:'old_player', wx:a.x - 90, wy:a.y });
      SP.drawUnit({ kind:'old', key:'old_mech', wx:a.x + 10, wy:a.y });
      SP.drawUnit({ kind:'old', key:'old_rune', wx:a.x + 110, wy:a.y });
      return true;
    })()`);
    await sleep(150);
    await shot(TAG + '-02-trio-old.png', { x: Math.max(0, anchorSX - 200), y: Math.max(0, anchorSY - 220), width: 520, height: 300 });

    // ---- 全屏一张（含 HUD，证明是游戏真实画面） ----
    await ev(`SP.clear()`);
    await sleep(150);
    await shot(TAG + '-03-scene-full.png', null);

    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.writeFileSync(path.join(OUT, TAG + '.json'), JSON.stringify(report, null, 2));
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(edge); } catch (e) { /* 忽略 */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
