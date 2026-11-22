/**
 * 剪影判据取样探针（只读，不改玩法）
 * ------------------------------------------------------------------
 * 为什么是"5 次中位数"：drawPlayer 的待机呼吸 / 头冠微摆 / 披风跟随都吃全局时间，
 * 同一份代码单次读数会抖（实测同版本连测 player-vs-any 从 0.209 掉到 0.168，-20%），
 * 单次读数不足以当判据。这里沿用可辨测试的指标定义（__roamDebug.unitSilhouetteAt, 60px），
 * 只把"取一次"改成"取 5 次中位数"，敌人本身是静态假单位、不受影响。
 *
 * 用法：
 *   node _probe/sil_gate_probe.js base      # 一般配合 ARCANE_MAIN 指向备份文件
 *   node _probe/sil_gate_probe.js after
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.ARCANE_MAIN ? path.resolve(process.env.ARCANE_MAIN) : path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'shots', 'audit');
const TAG = process.argv[2] || 'sil';
const PROFILE = path.join('D:\\.temp\\browser-profiles', `arcane-sil-${TAG}-${process.pid}-${Date.now()}`);
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const PORT = 9400 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找本机 Edge */
function findEdge() { for (const p of EDGE) if (fs.existsSync(p)) return p; throw new Error('找不到 msedge.exe'); }

/** 启动 headless Edge 并连 CDP */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  spawn(findEdge(), [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 未就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };
  /** 截画面（scale>1 放大，用来看清剪影层次） */
  const shot = async (name, clip, scale) => {
    const params = { format: 'png' };
    if (clip) params.clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.w), height: Math.round(clip.h), scale: scale || 1 };
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return name;
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch (e) { /* 忽略 */ } } };
}

/** 进入战斗：等初始化 → 开始 → 选卡 → 确认 → 等 playing → 传送到战斗房正中 */
async function enterPlaying(t) {
  const { ev } = t;
  await t.send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(1400);
  await ev(`(() => { const b = document.getElementById('btnStart'); if (b) b.click(); return 1; })()`);
  let cards = 0;
  for (let i = 0; i < 80; i += 1) {
    cards = await ev(`(() => document.querySelectorAll('.char-card').length)()`);
    if (cards > 0) break;
    await sleep(200);
  }
  if (!cards) throw new Error('选角卡没有出现');
  await ev(`(() => { document.querySelector('.char-card').click(); return 1; })()`);
  for (let i = 0; i < 20; i += 1) {
    if (await ev(`(() => !!window.__charArmed)()`) === true) break;
    await sleep(100);
  }
  await ev(`(() => { const b = document.getElementById('btnCharConfirm'); if (b) b.click(); return 1; })()`);
  for (let i = 0; i < 150; i += 1) {
    const st = await ev(`(() => { const d = window.__roamDebug; if (!d || !d.getState) return null; return { mode: d.getState().mode }; })()`);
    if (st && st.mode === 'playing') break;
    if (i > 0 && i % 40 === 0) await ev(`(() => { document.getElementById('btnCharConfirm').click(); return 1; })()`);
    await sleep(200);
  }
  const mode = await ev(`(() => window.__roamDebug.getState().mode)()`);
  if (mode !== 'playing') throw new Error('没能进入 playing（当前 mode=' + mode + '）');
  const room = await ev(`(() => { const r = (state.rooms || []).find((x) => x.type === 'battle') || state.rooms[1]; window.__roamDebug.teleport(r.cx, r.cy); return { id: r.id }; })()`);
  await sleep(900);
  await ev(`(() => { try { window.__roamDebug.clearEnemies(); } catch (e) {} const p = state.player; p.vx = 0; p.vy = 0; p.facingAngle = 0; p.walkBlend = 0; p.castAnim = 0; p.squash = 0; return 1; })()`);
  await sleep(500);
  return room;
}

/** 中位数 */
function median(arr) {
  const v = arr.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}

/** 主流程：玩家取 5 次中位数，敌人静态读一次，落盘 + 同机位特写 */
(async () => {
  const t = await boot();
  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  try {
    const room = await enterPlaying(t);
    say('main=' + MAIN);
    say('room=' + JSON.stringify(room));
    const unitsRaw = await t.ev('__roamDebug.identity.units()');
    const unitList = await t.ev(`(() => __roamDebug.identity.units().map((u) => u.id))()`);
    const enemy = {};
    for (const id of unitList) enemy[id] = await t.ev(`__roamDebug.identity.readOne(${JSON.stringify(id)}, 60)`);
    const playerRuns = [];
    for (let k = 0; k < 5; k += 1) {
      const s = await t.ev('__roamDebug.identity.readOne("player", 60)');
      if (s && s.__err) throw new Error(s.__err);
      playerRuns.push(s);
      await sleep(260);
    }
    const player = {
      aspect: +median(playerRuns.map((s) => s.aspect)).toFixed(3),
      complexity: +median(playerRuns.map((s) => s.complexity)).toFixed(3),
      fill: +median(playerRuns.map((s) => s.fill)).toFixed(3),
      bbox: playerRuns[2].bbox,
      runs: playerRuns.map((s) => ({ aspect: s.aspect, complexity: s.complexity, fill: s.fill, bbox: s.bbox }))
    };
    say('player(5次中位数)=' + JSON.stringify({ aspect: player.aspect, complexity: player.complexity, fill: player.fill, bbox: player.bbox }));
    say('player 单次抖动: aspect ' + playerRuns.map((s) => s.aspect).join(' / '));

    /* 同机位 3 倍特写：侧视静止 */
    await t.ev(`(() => { const p = state.player; p.facingAngle = 0; p.walkBlend = 0; p.castAnim = 0; p.squash = 0; return 1; })()`);
    await sleep(260);
    const clip = await t.ev(`(() => {
      const z = cameraZoom(); const dpr = ctx.canvas.width / state.viewW;
      return { x: Math.max(0, (state.player.x - state.cam.x) * z * dpr - 60), y: Math.max(0, (state.player.y - state.cam.y) * z * dpr - 70), w: 120, h: 145 };
    })()`);
    await t.shot(`sil-${TAG}-closeup.png`, clip, 3);
    say('已存 sil-' + TAG + '-closeup.png');

    fs.writeFileSync(path.join(OUT, `sil-${TAG}-median.json`), JSON.stringify({ main: MAIN, player, enemy, unitCount: unitsRaw.length }, null, 2));
    fs.writeFileSync(path.join(OUT, `sil-${TAG}.log`), log.join('\n'), 'utf8');
  } catch (e) {
    console.error('FAIL: ' + e.message);
    process.exitCode = 2;
  } finally {
    t.close();
    process.exit(process.exitCode || 0);
  }
})();
