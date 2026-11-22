/**
 * 打击感演示录制：连续 20 秒不停打，边打边录帧
 * ------------------------------------------------------------
 * 用法：node tools/fx123_demo.js [目标html] [输出目录] [秒数]
 * 默认：lab/index_fx123_candidate.html → lab/fx123/demo，20 秒
 *
 * 做法：
 *   1) 无头 Edge 打开游戏，跳过选人直接开局；
 *   2) 把命中注入到 fxTierFlush 之前（和探针同一手法），保证走完整分级链路；
 *   3) 每 150ms 对最近目标打一发（伤害在轻/重/击杀之间轮换，
 *      让 1px / 2px / 4px 震屏、顿帧、描边、粒子都能被录到）；
 *   4) 同时用 CDP screencast 抓帧，按 8fps 抽样落盘为 PNG 序列（静帧不算数）。
 *
 * 输出：frame_0001.png ... + meta.json（帧数、时长、每秒命中数）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9734;
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : path.join(ROOT, 'lab', 'index_fx123_candidate.html');
const OUT = process.argv[3] ? path.resolve(ROOT, process.argv[3]) : path.join(ROOT, 'lab', 'fx123', 'demo');
const SECONDS = Number(process.argv[4] || 20);
const FPS = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等就绪 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const frames = [];
  let lastKept = 0;
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.screencastFrame') {
      const ts = m.params.metadata.timestamp * 1000;
      if (ts - lastKept >= 1000 / FPS) {
        lastKept = ts;
        frames.push({ ts: ts, data: m.params.data });
      }
      ws.send(JSON.stringify({ id: ++seq, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
    }
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 60; i += 1) {
    if (await ev("!!document.getElementById('btnStart')")) break;
    await sleep(250);
  }
  /* 跳过角色选择并开局（只影响本次运行的临时标志） */
  await ev("(function(){ __charSkipPick = true; __charPickedThisBoot = true; if (typeof closeCharSelect === 'function') closeCharSelect(); startGame(); return true; })()");
  await sleep(1500);
  await ev("(function(){ if (typeof closeCharSelect === 'function') closeCharSelect(); var cl = (window.ui && ui.charLayer) || document.getElementById('charLayer'); if (cl) { cl.classList.add('hidden'); cl.style.display = 'none'; } return true; })()");
  await sleep(400);

  /* 命中注入钩子：帧桶在 update 开头重建，必须挂在 flush 之前 */
  await ev(`(function(){
    window.__fxQueue = [];
    var origFlush = window.fxTierFlush;
    window.fxTierFlush = function () {
      while (window.__fxQueue.length) {
        var f = window.__fxQueue.shift();
        try { f(); } catch (e) { window.__fxErr = String(e); }
      }
      return origFlush.apply(this, arguments);
    };
    return true;
  })()`);

  /* 布场：玩家居中 + 一圈 8 只怪 */
  await ev(`(function(){
    var d = window.__roamDebug;
    d.centerPlayer();
    d.despawnAll();
    for (var i = 0; i < 8; i += 1) {
      var a = Math.PI * 2 * i / 8;
      d.spawnEnemy(i % 2 ? 'warden' : 'wanderer', Math.cos(a) * 150, Math.sin(a) * 120);
    }
    state.player.hp = 99999; state.player.hpMax = 99999;
    return state.enemies.length;
  })()`);

  await send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: 1600, maxHeight: 900, everyNthFrame: 1 });

  const t0 = Date.now();
  let hits = 0;
  let tick = 0;
  while (Date.now() - t0 < SECONDS * 1000) {
    /* 每 150ms 打一发：伤害轮换 12(轻) / 30(重) / 999(击杀，触发 4px 与慢动作) */
    const dmg = [12, 12, 30, 12, 999][tick % 5];
    tick += 1;
    const fired = await ev(`(function(){
      var d = window.__roamDebug;
      /* 升级/楼层奖励会把 mode 切成 reward 并暂停战斗：自动选第一张，保证"连续不停打" */
      var guard = 0;
      while (state.mode === 'reward' && guard < 4) {
        try { chooseRewardByIndex(0); } catch (e) { break; }
        guard += 1;
      }
      var alive = state.enemies.filter(function (e) { return e.hp > 0; });
      if (!alive.length) {
        for (var i = 0; i < 6; i += 1) {
          var a = Math.PI * 2 * i / 6;
          d.spawnEnemy(i % 2 ? 'warden' : 'wanderer', Math.cos(a) * 150, Math.sin(a) * 120);
        }
        alive = state.enemies.filter(function (e) { return e.hp > 0; });
        if (!alive.length) return false;
      }
      var p = state.player;
      var best = null, bd = 1e9;
      for (var j = 0; j < alive.length; j += 1) {
        var dx = alive[j].x - p.x, dy = alive[j].y - p.y;
        var dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = alive[j]; }
      }
      if (!best) return false;
      var ang = Math.atan2(best.y - p.y, best.x - p.x);
      state.player.hp = state.player.hpMax;
      window.__fxQueue.push(function () { damageEnemy(best, ${dmg}, ang); });
      return true;
    })()`);
    if (fired) hits += 1;
    await sleep(150);
  }
  await send('Page.stopScreencast');
  await sleep(200);

  /* 落盘（JPEG → PNG 序列，文件名按时间递增） */
  let saved = 0;
  for (let i = 0; i < frames.length; i += 1) {
    const name = 'frame_' + String(i + 1).padStart(4, '0') + '.jpg';
    fs.writeFileSync(path.join(OUT, name), Buffer.from(frames[i].data, 'base64'));
    saved += 1;
  }
  const meta = {
    when: new Date().toISOString(),
    file: FILE,
    bytes: fs.statSync(FILE).size,
    seconds: SECONDS,
    sampleFps: FPS,
    frames: saved,
    attacks: hits,
    plan: '每 150ms 一发；伤害轮换 12/12/30/12/999（轻击 / 重击 / 击杀）'
  };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));

  ws.close();
  killEdge(edge);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
