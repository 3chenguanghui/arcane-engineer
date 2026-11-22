/**
 * X-A1 亮像素定位 + 逐项排除探针（只读诊断；不改 verify、不改游戏逻辑、不改阈值）
 * ---------------------------------------------------------------------------
 * 目的：回答"未探索房间（已被 alpha=1 迷雾压黑）里为什么会冒出亮像素"，方法：
 *   1) 复刻 verify 的 X-A1 采样：setFloor(6) → 关 seam/bloom → __roamDebug.fogLab.measure()
 *   2) 按 measure() 的 rect 重新扫描像素，锁定两类坐标：
 *        · 最亮像素（max）
 *        · p99 门槛像素（真正决定"p99>12"红绿的那个亮度）
 *      同时输出亮像素的行分布直方图（判断是"屏幕边缘/顶部 UI 带"还是"散点"）
 *   3) 逐项排除：每次只关一个渲染层，强制重绘两帧后在**同一坐标**读值，
 *      关完立刻恢复。清单见 TOGGLES。
 *   4) 因果对照（粒子假设）：把一只敌人搬进采样房中心击杀 → 扫描 → 关掉迷雾再扫描
 *      （阳性对照：证明粒子确实在画）→ 清空粒子并重绘 → 同一坐标再读。
 *
 * 用法：node tools/arcane_xa1_pixel.js [--file=绝对路径] [--rounds=6]
 * 输出：控制台表格 + .screenshots/fog/xa1pixel.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9579;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'fog');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{file:string,rounds:number}} 被测文件与轮数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k, d) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : d;
  };
  return {
    file: pick('file', path.join(ROOT, 'index_arcane_v2.html')),
    rounds: Number(pick('rounds', '6'))
  };
}

/**
 * 启动无头 Edge 并连上 CDP（与其它工具同套路）
 * @param {string} file 被测 HTML 绝对路径
 * @returns {Promise<{ev:Function, close:Function}>}
 */
async function boot(file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    try { if (await ev(`typeof state !== 'undefined' && typeof generateFloor === 'function'`)) break; } catch (e) { /* 仍在解析 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/**
 * 页面内脚本：定位亮像素 → 逐项排除 → 粒子因果对照
 * @param {number} rounds 定位轮数（每轮换一次 6 层布局）
 */
const PAGE_SCRIPT = (rounds) => `(async function(){
  const d = window.__roamDebug;
  const sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  const raf2 = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(); }); }); }); };

  /* 采样矩形换算：measure() 返回 CSS 坐标，取像素要乘 dpr 并内缩 26px（与 measure 完全一致） */
  const geom = function(m){
    const c = document.getElementById('game');
    const dpr = c.width / window.innerWidth;
    const pad = 26;
    const rx = Math.round((m.rect.x + pad) * dpr);
    const ry = Math.round((m.rect.y + pad) * dpr);
    const rw = Math.max(1, Math.round((m.rect.w - pad * 2) * dpr));
    const rh = Math.max(1, Math.round((m.rect.h - pad * 2) * dpr));
    return { c: c, dpr: dpr, rx: rx, ry: ry, rw: rw, rh: rh };
  };

  /* 读单个设备像素的亮度与 RGB */
  const pixel = function(g, x, y){
    if (x < g.rx || y < g.ry || x >= g.rx + g.rw || y >= g.ry + g.rh) return null;
    const d = g.c.getContext('2d').getImageData(x, y, 1, 1).data;
    return { rgb: [d[0], d[1], d[2]], l: Math.round((d[0]*0.2126 + d[1]*0.7152 + d[2]*0.0722) * 10) / 10 };
  };

  /* 全窗扫描：max / p99 / >12 像素数 / 行分布直方图 / 前 5 亮点 / p99 门槛像素坐标 */
  const scan = function(g){
    const data = g.c.getContext('2d').getImageData(g.rx, g.ry, g.rw, g.rh).data;
    const n = g.rw * g.rh;
    const lums = new Float32Array(n);
    const bands = [];
    const bandH = 40;
    for (let i = 0; i < n; i += 1) {
      const j = i * 4;
      lums[i] = data[j]*0.2126 + data[j+1]*0.7152 + data[j+2]*0.0722;
    }
    let max = -1, maxI = 0, over12 = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let i = 0; i < n; i += 1) {
      if (lums[i] > max) { max = lums[i]; maxI = i; }
      if (lums[i] > 12) {
        over12 += 1;
        const x = i % g.rw, y = Math.floor(i / g.rw);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const sorted = Array.prototype.slice.call(lums).sort(function(a,b){ return a - b; });
    const p99v = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
    /* p99 门槛像素：第一个 >= p99 的像素（定位"决定红绿的那一批"长什么样） */
    let p99i = -1;
    for (let i = 0; i < n; i += 1) { if (lums[i] >= p99v) { p99i = i; break; } }
    /* 行分布：每 40 设备像素一条，帮助判断"边缘/顶部 UI 带"还是"散点" */
    for (let y = 0; y < g.rh; y += bandH) {
      let c12 = 0, mx = 0;
      const y1 = Math.min(g.rh, y + bandH);
      for (let yy = y; yy < y1; yy += 1) {
        for (let x = 0; x < g.rw; x += 1) {
          const l = lums[yy * g.rw + x];
          if (l > 12) c12 += 1;
          if (l > mx) mx = l;
        }
      }
      bands.push({ y: y, over12: c12, max: Math.round(mx * 10) / 10 });
    }
    const mx = maxI % g.rw, my = Math.floor(maxI / g.rw);
    const p99x = p99i < 0 ? -1 : p99i % g.rw, p99y = p99i < 0 ? -1 : Math.floor(p99i / g.rw);
    return {
      n: n,
      max: Math.round(max * 10) / 10,
      maxDev: [g.rx + mx, g.ry + my],
      maxScreen: [Math.round((g.rx + mx) / g.dpr), Math.round((g.ry + my) / g.dpr)],
      maxRgb: [data[maxI*4], data[maxI*4+1], data[maxI*4+2]],
      p99: Math.round(p99v * 10) / 10,
      p99Dev: p99i < 0 ? null : [g.rx + p99x, g.ry + p99y],
      p99Rgb: p99i < 0 ? null : [data[p99i*4], data[p99i*4+1], data[p99i*4+2]],
      over12: over12,
      over12Box: over12 ? [g.rx + minX, g.ry + minY, maxX - minX + 1, maxY - minY + 1] : null,
      bands: bands,
      /* 相对采样窗的位置（0..1），对应"锁定像素在窗口里的相对位置" */
      rel: [Math.round(mx / g.rw * 1000) / 1000, Math.round(my / g.rh * 1000) / 1000]
    };
  };

  /* 状态快照：判断"是不是战斗演出/低血/暂停/隐藏页" */
  const snapshot = function(){
    const fx = (state && state.fx) ? state.fx : {};
    return {
      mode: state && state.mode,
      elapsed: state && Math.round(state.elapsed || 0),
      hidden: document.hidden,
      particles: (state.particles || []).length,
      rings: (state.rings || []).length,
      enemies: (state.enemies || []).length,
      hp: state && state.player ? Math.round(state.player.hp) : null,
      maxHp: state && state.player ? Math.round(state.player.maxHp) : null,
      fx: {
        bursts: (fx.bursts || []).length,
        impacts: (fx.impacts || []).length,
        magnet: (fx.magnet || []).length,
        shards: (fx.shards || []).length,
        screen: fx.screen ? (fx.screen.kind || fx.screen.type || 'on') : null,
        glitch: !!fx.glitch,
        scanline: !!fx.scanline,
        dissolve: !!fx.dissolve,
        lowHp: fx.lowHpLevel == null ? null : Math.round(fx.lowHpLevel * 1000) / 1000,
        screenLog: (fx.screenLog || []).slice(-2)
      }
    };
  };

  /* 进入实战：复刻 verify 的 enterPlaying（点开始 → 选角 → 确认 → 轮询 playing）。
     标题页下敌人不会攻击、也不会触发屏幕演出，正是以前 0/43 复现不到的根因。 */
  const enterPlaying = async function(){
    if (state.mode === 'playing') return state.mode;
    const b = document.getElementById('btnStart');
    if (b) b.click();
    for (let i = 0; i < 30; i += 1) {
      await sleep(100);
      if (state.mode === 'playing') return state.mode;
      const card = document.querySelector('#charGrid .char-card');
      if (card && (!card.classList.contains('selected'))) card.click();
      const cf = document.getElementById('btnCharConfirm');
      if (cf && cf.offsetParent !== null) cf.click();
      if (state.mode === 'playing') return state.mode;
    }
    return state.mode;
  };

  /* 逐项排除清单：每项 = 名字 + 关闭动作 + 恢复动作（每次只关一个） */
  const TOGGLES = [
    { name: 'drawScreenAtmosphere(大气层+浮尘)' },
    { name: 'drawPostFxLayer(色差/暗角/CRT)' },
    { name: 'drawFog 二次覆盖(secondPass)' },
    { name: 'drawFog 全部(阳性对照:会露出世界)' },
    { name: 'drawBossHud' },
    { name: 'drawComboEdge' },
    { name: 'drawPixelFxScreen(溶解/故障/扫描线/低血)' },
    { name: 'drawChallengeBanner' },
    { name: 'drawCrosshair' },
    { name: 'drawNarration' },
    { name: 'drawVoidDepth(远景层)' },
    { name: 'drawVoidApron(地面延伸带)' },
    { name: 'drawPixelFxWorld(击杀崩解方块)' },
    { name: 'drawEffects(粒子+冲击环)' },
    { name: 'lowHp 边(仅清零 lowHpLevel)' }
  ];

  /* 执行一次"关 → 重绘两帧 → 读 → 恢复 → 重绘两帧" */
  const applyOff = function(name){
    if (name === 'drawScreenAtmosphere(大气层+浮尘)') { const o = window.drawScreenAtmosphere; window.drawScreenAtmosphere = function(){}; return function(){ window.drawScreenAtmosphere = o; }; }
    if (name === 'drawPostFxLayer(色差/暗角/CRT)') { const o = window.drawPostFxLayer; window.drawPostFxLayer = function(){}; return function(){ window.drawPostFxLayer = o; }; }
    if (name === 'drawFog 二次覆盖(secondPass)') { const o = FOG_CONFIG.secondPass; FOG_CONFIG.secondPass = false; return function(){ FOG_CONFIG.secondPass = o; }; }
    if (name === 'drawFog 全部(阳性对照:会露出世界)') { const o = window.drawFog; window.drawFog = function(){}; return function(){ window.drawFog = o; }; }
    if (name === 'drawBossHud') { const o = window.drawBossHud; window.drawBossHud = function(){}; return function(){ window.drawBossHud = o; }; }
    if (name === 'drawComboEdge') { const o = window.drawComboEdge; window.drawComboEdge = function(){}; return function(){ window.drawComboEdge = o; }; }
    if (name === 'drawPixelFxScreen(溶解/故障/扫描线/低血)') { const o = window.drawPixelFxScreen; window.drawPixelFxScreen = function(){}; return function(){ window.drawPixelFxScreen = o; }; }
    if (name === 'drawChallengeBanner') { const o = window.drawChallengeBanner; window.drawChallengeBanner = function(){}; return function(){ window.drawChallengeBanner = o; }; }
    if (name === 'drawCrosshair') { const o = window.drawCrosshair; window.drawCrosshair = function(){}; return function(){ window.drawCrosshair = o; }; }
    if (name === 'drawNarration') { const o = window.drawNarration; window.drawNarration = function(){}; return function(){ window.drawNarration = o; }; }
    if (name === 'drawVoidDepth(远景层)') { const o = window.drawVoidDepth; window.drawVoidDepth = function(){}; return function(){ window.drawVoidDepth = o; }; }
    if (name === 'drawVoidApron(地面延伸带)') { const o = window.drawVoidApron; window.drawVoidApron = function(){}; return function(){ window.drawVoidApron = o; }; }
    if (name === 'drawPixelFxWorld(击杀崩解方块)') { const o = window.drawPixelFxWorld; window.drawPixelFxWorld = function(){}; return function(){ window.drawPixelFxWorld = o; }; }
    if (name === 'drawEffects(粒子+冲击环)') { const o = window.drawEffects; window.drawEffects = function(){}; return function(){ window.drawEffects = o; }; }
    if (name === 'lowHp 边(仅清零 lowHpLevel)') { const o = state.fx.lowHpLevel; state.fx.lowHpLevel = 0; return function(){ state.fx.lowHpLevel = o; }; }
    return null;
  };

  const out = { rounds: [], toggles: [], particleTest: null, precheck: {} };
  out.enterMode = await enterPlaying();

  /* 先确认这些函数确实是全局可替换的（否则排除法全部无效，必须先报告） */
  ['drawScreenAtmosphere','drawPostFxLayer','drawFog','drawBossHud','drawComboEdge','drawPixelFxScreen','drawChallengeBanner','drawCrosshair','drawNarration','drawVoidDepth','drawVoidApron','drawPixelFxWorld','drawEffects'].forEach(function(k){
    out.precheck[k] = (typeof window[k] === 'function') && (window[k] === eval(k));
  });

  /* 逐项排除：必须在"该轮布局仍然有效"的当下执行，所以做成函数在轮内调用 */
  const runToggles = async function(worst){
    const g = worst.g;
    const locked = worst.s.maxDev;
    const p99Locked = worst.s.p99Dev;
    const base = scan(g);
    for (let i = 0; i < TOGGLES.length; i += 1) {
      const name = TOGGLES[i].name;
      const revert = applyOff(name);
      if (!revert) { out.toggles.push({ name: name, note: 'no-op(找不到替换目标)' }); continue; }
      await raf2(); await sleep(60);
      const pxMax = pixel(g, locked[0], locked[1]);
      const pxP99 = p99Locked ? pixel(g, p99Locked[0], p99Locked[1]) : null;
      const sc = scan(g);
      out.toggles.push({
        name: name,
        atMax: pxMax,
        atP99: pxP99,
        scan: { max: sc.max, p99: sc.p99, over12: sc.over12 }
      });
      revert();
      await raf2(); await sleep(60);
      /* 恢复自检：恢复后锁定坐标必须回到原值（否则说明有副作用没清干净） */
      const back = pixel(g, locked[0], locked[1]);
      if (back && Math.abs(back.l - base.max) > 0.6) {
        out.toggles[out.toggles.length - 1].restoreWarn = { expect: base.max, got: back.l };
      }
    }
    out.worstRound = { k: worst.k, roomId: worst.m.roomId, rect: worst.m.rect, scan: worst.s, snap: worst.snap, locked: locked, lockedRel: worst.s.rel, p99Locked: p99Locked };
  };

  let last = null;
  for (let k = 0; k < ${rounds}; k += 1) {
    d.setFloor(6);
    for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    await sleep(800);
    const cfg0 = d.fogLab.config();
    d.fogLab.setSeam(0);
    d.fogLab.setBloom(false);
    await sleep(600);
    const m = d.fogLab.measure();
    if (!m || !m.rect) { out.rounds.push({ k: k, note: 'measure 返回 null' }); continue; }
    const g = geom(m);
    const s = scan(g);
    const snap = snapshot();
    out.rounds.push({ k: k, roomId: m.roomId, rect: m.rect, p99: m.p99, max: m.max, avg: m.avg, px: m.px, scan: s, snap: snap });
    last = { k: k, m: m, g: g, s: s, snap: snap, cfg0: cfg0 };
    /* 第一轮做粒子因果对照（不依赖"偶发 206.2"，主动造一次死亡崩解） */
    if (k === 0) {
      const room = state.rooms[m.roomId];
      const victim = (state.enemies || [])[0];
      if (victim && room) {
        victim.x = room.cx; victim.y = room.cy;
        killEnemy(victim);
        await sleep(120);
        const withFog = scan(g);
        const fogOff = window.drawFog; window.drawFog = function(){};
        await raf2(); await sleep(80);
        const noFog = scan(g);
        window.drawFog = fogOff;
        await raf2(); await sleep(80);
        /* 清粒子 + 冲击环，强制重绘两帧，再看同一坐标是否还亮 */
        const beforeClear = scan(g);
        state.particles.length = 0; state.rings.length = 0;
        if (state.fx && state.fx.shards) state.fx.shards.length = 0;
        if (state.fx && state.fx.bursts) state.fx.bursts.length = 0;
        await raf2(); await sleep(80);
        const afterClear = scan(g);
        out.particleTest = {
          killedInRoom: { roomId: m.roomId, cx: room.cx, cy: room.cy },
          withFog: { max: withFog.max, p99: withFog.p99, maxDev: withFog.maxDev, maxRgb: withFog.maxRgb },
          noFog: { max: noFog.max, p99: noFog.p99, maxDev: noFog.maxDev, maxRgb: noFog.maxRgb },
          beforeClear: { max: beforeClear.max, p99: beforeClear.p99, maxDev: beforeClear.maxDev },
          afterClear: { max: afterClear.max, p99: afterClear.p99, maxDev: afterClear.maxDev },
          afterClearSnap: snapshot()
        };
      } else {
        out.particleTest = { note: '没有敌人可击杀', enemies: (state.enemies || []).length, roomId: m.roomId };
      }

      /* 提灯柔光因果实验：drawScreenAtmosphere 的柔光半径 = max(w,h)*0.72、中心 alpha 0.072。
         把玩家挪到采样房墙外 60px（不进房，避免揭雾），看 p99 是否必然越过 12；
         再挪到 3000px 外看是否回落。这是"红=p99 大面积暗光"的直接因果检验。 */
      const room2 = state.rooms[m.roomId];
      if (room2) {
        const save = { x: state.player.x, y: state.player.y, vx: state.player.vx, vy: state.player.vy };
        const nearFar = async function(px0, py0) {
          state.player.x = px0; state.player.y = py0;
          if ('vx' in state.player) state.player.vx = 0;
          if ('vy' in state.player) state.player.vy = 0;
          await raf2(); await sleep(120); await raf2();
          const s = scan(g);
          return { px: px0, py: py0, p99: s.p99, max: s.max, over12: s.over12, box: s.over12Box, rel: s.rel, snap: snapshot() };
        };
        const near = await nearFar(room2.x + room2.w / 2, room2.y + room2.h + 60);
        const far = await nearFar(room2.x + room2.w / 2, room2.y + room2.h + 3000);
        state.player.x = save.x; state.player.y = save.y;
        if ('vx' in state.player) state.player.vx = save.vx;
        if ('vy' in state.player) state.player.vy = save.vy;
        out.glowTest = { roomId: m.roomId, room: { x: room2.x, y: room2.y, w: room2.w, h: room2.h }, rect: m.rect, near: near, far: far };
      } else {
        out.glowTest = { note: '拿不到房间坐标', roomId: m.roomId };
      }

      /* 阳性对照：只打开"开局仪式"（verify 里 X-A1 紧跟 enterPlaying，仪式 2.0s 可能还没结束）。
         仪式文案 rgba(234,246,255,0.95) 叠黑 ≈ 232 亮度，抗锯齿边缘正好落在 206 附近，
         且画在迷雾之上 —— 这是唯一能在采样窗里造出 200+ 亮度的候选。 */
      if (typeof startOpeningRitual === 'function' && typeof openingRitual === 'object') {
        openingRitual.played = false;
        const ok = startOpeningRitual();
        await sleep(900);
        const s = scan(g);
        out.ritualTest = {
          ok: !!ok, active: openingRitual.active, t: openingRitual.t,
          p99: s.p99, max: s.max, maxDev: s.maxDev, maxRgb: s.maxRgb,
          over12: s.over12, box: s.over12Box, rel: s.rel,
          bands: s.bands.filter(function(b){ return b.over12 > 0; })
        };
        /* 仪式文案位置实测（y≈viewH*0.70，居中）：只回答"这层白字能到多亮" */
        const vw = state.viewW || window.innerWidth;
        const vh = state.viewH || window.innerHeight;
        const gText = { c: g.c, dpr: g.dpr, rx: Math.round(vw * 0.3), ry: Math.round(vh * 0.655), rw: Math.round(vw * 0.4), rh: Math.round(vh * 0.09) };
        const st = scan(gText);
        out.ritualText = { rect: [gText.rx, gText.ry, gText.rw, gText.rh], p99: st.p99, max: st.max, maxRgb: st.maxRgb, maxDev: st.maxDev, over12: st.over12 };
        openingRitual.active = false; openingRitual.played = true;
        await raf2();
      }
    }
    /* 命中 206 级亮点 → 就地排除（布局仍有效）；否则在最后一轮做常规排除 */
    const isLast = (k === ${rounds} - 1);
    /* 红 = p99>12（真判据）；206 级亮点也单独抓。命中任一条就地排除 */
    if (!out.worstRound && (s.p99 > 12 || s.max >= 100 || isLast)) {
      await runToggles(last);
    }
    /* 恢复 seam/bloom（不跨轮污染） */
    SCENE_READ_CONFIG.seamMul = cfg0.seamMul;
    SCENE_READ_CONFIG.gridMul = cfg0.gridMul;
    if (typeof bakeScene === 'function') bakeScene();
    d.fogLab.setBloom(cfg0.bloom);
    await sleep(300);
    if (out.worstRound) break;
  }
  return out;
})()`;

/**
 * 主流程：跑定位 + 排除，打印人读表
 */
async function main() {
  const args = parseArgs();
  const { ev, close } = await boot(args.file);
  try {
    const out = await ev(PAGE_SCRIPT(args.rounds));
    console.log('== 函数可替换性预检（false = 该层无法用排除法关闭）==');
    console.log(JSON.stringify(out.precheck));
    console.log('enterMode=' + out.enterMode);
    console.log('\n== 定位轮 ==');
    out.rounds.forEach((r) => {
      if (r.note) { console.log(`#${r.k} ${r.note}`); return; }
      const s = r.scan;
      const topBands = s.bands.slice().sort((a, b) => b.over12 - a.over12).slice(0, 2).map((b) => `y${b.y}:${b.over12}/${b.max}`).join(' ');
      console.log(`#${r.k} room=${r.roomId} rect=${JSON.stringify(r.rect)} p99=${r.p99} max=${r.max} 最亮@${s.maxDev} rel=${s.rel[0]},${s.rel[1]} rgb=${s.maxRgb} >12=${s.over12} box=${JSON.stringify(s.over12Box)} 亮带=${topBands} fx=${JSON.stringify(r.snap.fx)} hp=${r.snap.hp} enemies=${r.snap.enemies} mode=${r.snap.mode}`);
    });
    if (out.particleTest) {
      console.log('\n== 粒子因果对照 ==');
      console.log(JSON.stringify(out.particleTest, null, 1));
    }
    if (out.glowTest) {
      console.log('\n== 提灯柔光因果实验 ==');
      const g0 = out.glowTest;
      if (g0.note) console.log(g0.note);
      else {
        console.log(`room=${g0.roomId} roomBox=${JSON.stringify(g0.room)} rect=${JSON.stringify(g0.rect)}`);
        console.log(`玩家挪到墙外60px: p99=${g0.near.p99} max=${g0.near.max} >12=${g0.near.over12} box=${JSON.stringify(g0.near.box)}`);
        console.log(`玩家挪到3000px外: p99=${g0.far.p99} max=${g0.far.max} >12=${g0.far.over12} box=${JSON.stringify(g0.far.box)}`);
      }
    }
    if (out.worstRound) {
      console.log('\n== 逐项排除（最亮一轮锁定）==');
      console.log(`锁定轮 #${out.worstRound.k} room=${out.worstRound.roomId} rect=${JSON.stringify(out.worstRound.rect)} 最亮像素@${out.worstRound.locked} rel=${out.worstRound.lockedRel} p99像素@${out.worstRound.p99Locked}`);
      console.log(`基线 max=${out.worstRound.scan.max} p99=${out.worstRound.scan.p99}`);
      out.toggles.forEach((t) => {
        if (t.note) { console.log(`${t.name}: ${t.note}`); return; }
        console.log(`${t.name}: 锁定像素 ${t.atMax && t.atMax.l} (rgb ${t.atMax && t.atMax.rgb}) | p99像素 ${t.atP99 && t.atP99.l} | 全窗 max=${t.scan.max} p99=${t.scan.p99} >12=${t.scan.over12}${t.restoreWarn ? ' | 恢复异常 ' + JSON.stringify(t.restoreWarn) : ''}`);
      });
    }
    fs.writeFileSync(path.join(OUT_DIR, 'xa1pixel.json'), JSON.stringify({ file: args.file, out }, null, 2));
    console.log('\n已写入 .screenshots/fog/xa1pixel.json');
  } finally {
    close();
  }
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
