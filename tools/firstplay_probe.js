/**
 * 首玩复现探针（只读）
 * ------------------------------------------------------------
 * 目的：按"什么都不知道的新人"路径打开 delivery 试玩版，取证 7 条反馈。
 * 铁律：
 *   1) 本脚本只调用真实 DOM 点击 / 真实键盘事件 / 只读快照；
 *   2) 不修改游戏源码、不写 localStorage（除游戏自己存档）、不改判据；
 *   3) 所有结论落盘到 .screenshots/firstplay/report.json + 截图。
 *
 * 复现路径（与用户一致）：
 *   打开文件 → 标题 → 点「开始探索」→ 选角色 → 点「以此角色开始」→ 第一层。
 *
 * 覆盖：
 *   A. 键盘焦点 A/B：进入 playing 后「不点画布」按 W/J，再「点一次画布」重复；
 *   B. 选角 → 进房状态机：逐 100ms 记录 state.mode / 角色层可见性 / 黑场遮罩；
 *   C. 第 1–3 层首屏截图 + 可见引导元素文本；
 *   D. 融合：解锁状态、已持有魔法/科技、getAvailableFusions()、融合提示 DOM；
 *   E. 迷雾硬边：直接读迷雾离屏画布的 alpha 剖面，量相邻像素最大跳变；
 *   F. 门 / 地图点击：点门、点地图房间，看是否发生"跳转"。
 *
 * 用法：node tools/firstplay_probe.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.resolve(__dirname, '..', 'delivery', '烬-奥术工程师-试玩版.html');
const OUT = path.resolve(__dirname, '..', '.screenshots', 'firstplay');
const PORT_BASE = 9760;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主流程：启动 Edge → 复现 → 落盘
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const report = {
    file: FILE,
    startedAt: new Date().toISOString(),
    viewport: null,
    consoleErrors: [],
    steps: {},
    screenshots: []
  };

  /* ---------- 1. 起一个干净的 Edge（profile 每次清空 = 首玩存档） ---------- */
  let edge = null;
  let target = null;
  for (let attempt = 0; attempt < 6 && !target; attempt += 1) {
    const port = PORT_BASE + Math.floor(Math.random() * 200);
    const profile = prepareProfile();
    edge = spawn(EDGE, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--allow-file-access-from-files',
      '--window-size=1440,900',
      'about:blank'
    ], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !target; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        target = list.find((t) => t.type === 'page') || null;
      } catch (e) { /* 端口未就绪，继续等 */ }
      if (!target) await sleep(250);
    }
    if (!target) {
      console.log(`启动重试：端口 ${port} 未就绪`);
      try { killEdge(edge); } catch (e) { /* 忽略 */ }
      await sleep(400);
    }
  }
  if (!target) throw new Error('调试端口未就绪');

  /* ---------- 2. CDP 通道 ---------- */
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const consoleEvents = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) consoleEvents.push(msg);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  /**
   * 在页面里求值（返回可序列化值）
   * @param {string} expression JS 表达式
   * @returns {Promise<any>} 结果
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      return { __evalError: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '') };
    }
    return r.result.value;
  };

  /**
   * 截图到 .screenshots/firstplay/
   * @param {string} name 文件名
   * @returns {Promise<void>}
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    report.screenshots.push(name);
  };

  /**
   * 用真实鼠标事件点元素中心（会触发 focus，等价玩家点击）
   * @param {string} selector CSS 选择器
   * @returns {Promise<boolean>} 是否点到
   */
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
    if (!rect || rect.__evalError) return false;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    return true;
  };

  /**
   * 按下并持续 holdMs 再松开（移动键需要"按住"才有位移）
   * @param {string} key event.key
   * @param {string} code event.code
   * @param {number} vk Windows 虚拟键码
   * @param {number} holdMs 按住时长
   * @returns {Promise<void>}
   */
  const pressKey = async (key, code, vk, holdMs = 80) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(holdMs);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(80);
  };

  /* ---------- 3. 打开文件、等首屏 ---------- */
  const url = pathToFileURL(FILE).href;
  await send('Page.navigate', { url });
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 20000) {
    const s = await ev(`(function(){ var t=document.getElementById('titleLayer');
      return { ready: document.readyState, hasState: (typeof state !== 'undefined'),
               titleVisible: !!t && !t.classList.contains('hidden') }; })()`);
    if (s && s.ready === 'complete' && s.hasState && s.titleVisible) { ready = true; break; }
    await sleep(100);
  }
  report.bootMs = Date.now() - t0;
  report.steps.titleReady = ready;
  report.viewport = await ev(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
      canvas: (function(){ var c=document.getElementById('game'); if(!c) return null; var r=c.getBoundingClientRect();
      return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), bw:c.width, bh:c.height }; })(),
      active: (function(){ var a=document.activeElement; return a ? (a.id || a.tagName) : 'none'; })() })`);
  await shot('00-title.png');

  /* ---------- 4. 点「开始探索」→ 选角层 ---------- */
  report.steps.startClicked = await clickElement('#btnStart');
  await sleep(400);
  report.steps.charLayer = await ev(`(function(){
    var el = document.getElementById('charLayer');
    var grid = document.getElementById('charGrid');
    var confirm = document.getElementById('btnCharConfirm');
    return {
      open: !!el && !el.classList.contains('hidden'),
      mode: state ? state.mode : null,
      cards: grid ? grid.querySelectorAll('.char-card').length : 0,
      confirmText: confirm ? confirm.textContent.trim() : '',
      confirmRect: confirm ? (function(){ var r=confirm.getBoundingClientRect();
        return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom)}; })() : null,
      active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none',
      viewport: { w: innerWidth, h: innerHeight }
    };
  })()`);
  await shot('01-char-select.png');

  /* ---------- 5. 单点第一张卡（不双击）→ 点确认 ---------- */
  report.steps.cardClicked = await clickElement('#charGrid .char-card');
  await sleep(250);
  report.steps.charArmed = await ev(`({ armed: (typeof __charArmed!=='undefined')?__charArmed:null,
      highlighted: (typeof __charHighlight!=='undefined')?__charHighlight:null,
      confirmDisabled: (function(){ var b=document.getElementById('btnCharConfirm'); return b ? b.disabled : null; })(),
      nudge: (function(){ var g=document.getElementById('charGrid'); return g ? g.classList.contains('is-need-pick') : null; })() })`);
  await shot('02-char-picked.png');

  const tConfirm = Date.now();
  report.steps.confirmClicked = await clickElement('#btnCharConfirm');
  // 逐 100ms 采样 4 秒：mode / 角色层 / 黑场遮罩 / 世界是否已渲染
  const timeline = [];
  for (let i = 0; i < 40; i += 1) {
    const snap = await ev(`(function(){
      var cl=document.getElementById('charLayer');
      var veil=document.getElementById('bootVeil');
      return { t: performance.now()|0, mode: state?state.mode:null, status: state?state.status:null,
        charOpen: !!cl && !cl.classList.contains('hidden'),
        player: state&&state.player ? {x:Math.round(state.player.x),y:Math.round(state.player.y)} : null,
        floor: state?state.floor:null, rooms: state&&state.rooms?state.rooms.length:-1,
        bootVeil: veil ? { cls: veil.className, op: getComputedStyle(veil).opacity } : null };
    })()`);
    timeline.push(Object.assign({ ms: Date.now() - tConfirm }, snap));
    if (i === 2) await shot('03-after-confirm-250ms.png');
    if (i === 9) await shot('04-after-confirm-1000ms.png');
    await sleep(100);
  }
  report.steps.confirmTimeline = timeline;
  report.steps.playingReachedMs = (timeline.find((x) => x.mode === 'playing') || {}).ms || null;
  await shot('05-first-playable.png');

  /* ---------- 6. 键盘焦点 A/B ---------- */
  /**
   * 测一次键盘：按住 W 400ms 看位移；再按 J 看冷却是否变化。
   * @param {string} label 记录标签（A=未点画布 / B=点过画布）
   * @returns {Promise<Object>} 读数
   */
  const keyboardProbe = async (label) => {
    const before = await ev(`(function(){
      return { x: state.player.x, y: state.player.y,
        active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none',
        opening: (typeof openingRitual!=='undefined') ? openingRitual.active : null,
        keys: JSON.parse(JSON.stringify(state.keys||{})),
        cd: JSON.parse(JSON.stringify(state.cooldowns||{})) };
    })()`);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
    await sleep(150);
    const during = await ev(`({ up: !!state.keys.up, x: state.player.x, y: state.player.y })`);
    await sleep(250);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
    await sleep(120);
    const after = await ev(`({ x: state.player.x, y: state.player.y, up: !!state.keys.up })`);
    await pressKey('j', 'KeyJ', 74, 60);
    await sleep(120);
    const afterJ = await ev(`({ cd: JSON.parse(JSON.stringify(state.cooldowns||{})),
      aether: Number(state.player.aether||0).toFixed(1),
      shots: (state.stats && state.stats.shots!=null) ? state.stats.shots : null })`);
    return {
      label,
      activeElement: before.active,
      openingRitualBefore: before.opening,
      movedPx: Math.round(Math.hypot(after.x - before.x, after.y - before.y) * 10) / 10,
      keyFlagDuringHold: during.up,
      keyFlagAfterRelease: after.up,
      cooldownBefore: before.cd,
      cooldownAfterJ: afterJ.cd,
      aether: afterJ.aether,
      shots: afterJ.shots
    };
  };
  report.steps.keyboardA = await keyboardProbe('A：加载后未点画布');
  await shot('06-keyboard-A.png');

  // 真实点击画布中心（玩家视角：先点一下画面）
  await clickElement('#game');
  await sleep(300);
  report.steps.canvasClicked = await ev(`({ active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none',
      mode: state.mode })`);
  report.steps.keyboardB = await keyboardProbe('B：点过画布之后');
  await shot('07-keyboard-B.png');

  /* ---------- 7. 首屏引导元素（第 1 层） ---------- */
  /**
   * 抓取"屏幕上正在说话的东西"：教练条 / 开场提示 / toast / 塔灵 / 融合提示 / 门牌
   * @returns {Promise<Array<Object>>} 可见元素列表
   */
  const guidanceSnapshot = async () => ev(`(function(){
    var ids = ['introHint','onboardHint','toast','spiritLine','fusionHint','fusionBar','fusionNote','floorPanel','minimap','magicDeckHint'];
    var out = [];
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if (!el) return;
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var visible = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width > 1 && r.height > 1;
      out.push({ id: id, visible: visible, hiddenClass: el.classList.contains('hidden'),
        opacity: Number(cs.opacity).toFixed(2),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160) });
    });
    // 所有门牌 / 箭头统计（渲染层统计，不是猜测）
    var stats = (typeof DOOR_VIS_STATS !== 'undefined') ? JSON.parse(JSON.stringify(DOOR_VIS_STATS)) : null;
    return { elements: out, doorStats: stats,
      roomEntry: state.roomEntry ? JSON.parse(JSON.stringify(state.roomEntry)) : null,
      currentRoomId: state.currentRoomId, rooms: state.rooms.length,
      camera: { x: Math.round(state.cam.x), y: Math.round(state.cam.y), zoom: (typeof cameraZoom==='function') ? Number(cameraZoom().toFixed(2)) : null } };
  })()`);
  report.steps.floor1 = await guidanceSnapshot();
  await shot('10-floor1-first.png');

  /* ---------- 8. 第 2 / 3 层首屏 ---------- */
  for (const n of [2, 3]) {
    await ev(`window.__roamDebug.setFloor(${n})`);
    await sleep(900);
    report.steps['floor' + n] = await guidanceSnapshot();
    await shot(`1${n - 1}-floor${n}-first.png`);
  }

  /* ---------- 9. 融合可读性 ---------- */
  report.steps.fusion = await ev(`(function(){
    var avail = [];
    try { avail = (typeof getAvailableFusions==='function') ? getAvailableFusions().map(function(f){ return f.id; }) : []; } catch(e) { avail = ['ERR:'+e.message]; }
    var hint = document.getElementById('fusionHint');
    var note = document.getElementById('fusionNote');
    var hs = hint ? getComputedStyle(hint) : null;
    var hr = hint ? hint.getBoundingClientRect() : null;
    return {
      unlocked: !!(state.meta && state.meta.unlocks && state.meta.unlocks.fusion),
      metaUnlocks: state.meta ? JSON.parse(JSON.stringify(state.meta.unlocks||{})) : null,
      ownedMagic: (state.ownedMagic||[]).slice(),
      ownedTech: (state.ownedTech||[]).slice(),
      fusions: (state.fusions||[]).slice(),
      available: avail,
      hintVisible: !!hint && hs.display!=='none' && Number(hs.opacity)>0.05 && hr.width>1,
      hintRect: hr ? { x:Math.round(hr.x), y:Math.round(hr.y), w:Math.round(hr.width), h:Math.round(hr.height) } : null,
      hintText: hint ? hint.innerText.replace(/\\s+/g,' ').trim() : '',
      noteText: note ? note.innerText.replace(/\\s+/g,' ').trim() : '',
      hasTechHint: !!(note && /科技/.test(note.innerText)),
      helpHasFusionTab: !!document.querySelector('[data-help-tab="fusion"], .help-tab[data-tab="fusion"]')
    };
  })()`);
  await shot('20-fusion-deck.png');

  /* ---------- 10. 迷雾 alpha 剖面（原尺寸数值，不缩放） ---------- */
  report.steps.fog = await ev(`(function(){
    if (typeof fogCtx === 'undefined' || !fogCtx || !state.rooms) return { err: 'no-fog-ctx' };
    var target = null;
    for (var i=0;i<state.rooms.length;i+=1){
      var r = state.rooms[i];
      if (!state.fog.seenRooms[r.id]) { target = r; break; }
    }
    if (!target) return { err: 'all-seen', seen: Object.keys(state.fog.seenRooms||{}).length };
    var fs = (typeof fogScaleFactor !== 'undefined') ? fogScaleFactor : 1;
    var cx = Math.round((target.x + target.w/2) * fs);
    var y0 = Math.round((target.y - 40) * fs);
    var y1 = Math.round((target.y + 40) * fs);
    var img = fogCtx.getImageData(cx, y0, 1, Math.max(2, y1-y0));
    var a = [];
    for (var j=0;j<img.data.length;j+=4) a.push(img.data[j+3]);
    var maxStep = 0, stepAt = -1;
    for (var k=1;k<a.length;k+=1){ var d=Math.abs(a[k]-a[k-1]); if (d>maxStep){ maxStep=d; stepAt=k; } }
    return {
      room: { id: target.id, x: Math.round(target.x), y: Math.round(target.y), w: Math.round(target.w), h: Math.round(target.h) },
      feather: FOG_CONFIG.feather, secondPass: FOG_CONFIG.secondPass, fogScaleFactor: fs,
      worldW: fogWorldW, worldH: fogWorldH,
      sampleAxis: 'vertical @ room top edge', sampleCount: a.length,
      alphaProfile: a,
      maxAdjacentStep: maxStep, stepIndex: stepAt,
      note: 'alpha 255 = 未探索纯黑；0 = 已探索'
    };
  })()`);
  await shot('30-fog-boundary.png');

  /* ---------- 11. 门 / 地图点击测试 ---------- */
  report.steps.doorClick = await ev(`(function(){
    if (!state.doors || !state.doors.length) return { err: 'no-doors' };
    var p = state.player;
    var best = null, bd = Infinity;
    state.doors.forEach(function(d){
      var dd = Math.hypot((d.x||0)-p.x, (d.y||0)-p.y);
      if (dd < bd) { bd = dd; best = d; }
    });
    return { nearestDoor: best ? { roomId: best.roomId, targetRoomId: best.targetRoomId, x: Math.round(best.x), y: Math.round(best.y) } : null,
      dist: Math.round(bd), player: { x: Math.round(p.x), y: Math.round(p.y) },
      currentRoomId: state.currentRoomId,
      armedUntil: state.roomEntry ? state.roomEntry.armedUntil : null };
  })()`);
  // 把玩家挪到最近门前（调试口只移动坐标，不改玩法状态），然后先"点一下门"再"按 E"
  if (report.steps.doorClick && report.steps.doorClick.nearestDoor) {
    const d = report.steps.doorClick.nearestDoor;
    await ev(`(function(){ state.player.x=${d.x}; state.player.y=${d.y}; state.player.vx=0; state.player.vy=0;
      if (typeof snapCamera==='function') snapCamera(); return true; })()`);
    await sleep(300);
    await clickElement('#game');
    await sleep(400);
    report.steps.doorClick.afterClick = await ev(`({ currentRoomId: state.currentRoomId, mode: state.mode,
      player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
      armedUntil: state.roomEntry ? state.roomEntry.armedUntil : null })`);
    await pressKey('e', 'KeyE', 69, 80);
    await sleep(300);
    report.steps.doorClick.afterE = await ev(`({ currentRoomId: state.currentRoomId, mode: state.mode,
      player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
      armedUntil: state.roomEntry ? state.roomEntry.armedUntil : null })`);
  }

  // 地图：按 M 打开 → 点地图中心的房间 → 看是否跳转
  await pressKey('m', 'KeyM', 77, 60);
  await sleep(400);
  report.steps.mapPanel = await ev(`(function(){ var p=document.getElementById('mapPanel');
    return { open: !!p && getComputedStyle(p).display!=='none' && Number(getComputedStyle(p).opacity)>0.05, mode: state.mode,
      canvas: (function(){ var c=document.getElementById('mapCanvas'); if(!c) return null; var r=c.getBoundingClientRect();
        return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; })() }; })()`);
  await clickElement('#mapCanvas');
  await sleep(400);
  report.steps.mapClick = await ev(`({ mode: state.mode, currentRoomId: state.currentRoomId,
    toast: (document.getElementById('toast')||{}).innerText || '' })`);
  await shot('40-map.png');
  await pressKey('m', 'KeyM', 77, 60);
  await sleep(250);

  /* ---------- 12. 控制台错误汇总 ---------- */
  const pageErrors = await ev(`(window.__errors||[]).slice()`);
  const runtimeErrors = consoleEvents.filter((m) => (m.method === 'Runtime.exceptionThrown')
    || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    || (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)))
    .map((m) => {
      if (m.method === 'Runtime.exceptionThrown') return 'EXC: ' + (m.params.exceptionDetails.text || '') + ' ' + ((m.params.exceptionDetails.exception || {}).description || '');
      if (m.method === 'Log.entryAdded') return m.params.entry.level.toUpperCase() + ': ' + m.params.entry.text;
      return 'CONSOLE: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
    });
  report.consoleErrors = { page: pageErrors, runtime: runtimeErrors };

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('=== SUMMARY ===');
  console.log(JSON.stringify({
    bootMs: report.bootMs,
    viewport: report.viewport,
    charLayer: report.steps.charLayer,
    playingReachedMs: report.steps.playingReachedMs,
    keyboardA: report.steps.keyboardA,
    keyboardB: report.steps.keyboardB,
    canvasClicked: report.steps.canvasClicked,
    fusion: report.steps.fusion,
    fog: report.steps.fog && {
      feather: report.steps.fog.feather, secondPass: report.steps.fog.secondPass,
      scale: report.steps.fog.fogScaleFactor, maxAdjacentStep: report.steps.fog.maxAdjacentStep,
      profile: report.steps.fog.alphaProfile
    },
    doorClick: report.steps.doorClick,
    mapPanel: report.steps.mapPanel,
    mapClick: report.steps.mapClick,
    consoleErrors: report.consoleErrors
  }, null, 2));
  console.log('OUT=' + OUT);

  try { ws.close(); } catch (e) { /* 已关闭 */ }
  killEdge(edge);
}

main().catch((error) => {
  console.error('PROBE FAILED', error && error.stack || error);
  process.exitCode = 1;
});
