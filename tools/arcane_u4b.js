/**
 * U4b「三个 Boss 各 1 个独有机制」验收脚本（端口 9494）
 * ------------------------------------------------------------
 * 断言见 .spec/u4b-boss/spec.md 第 4 节（13 项）。
 *
 * 口径说明：
 *   · 招牌机制是独立计时器，`forceBossSig()` 会清掉当前前摇再触发，保证结果可判定；
 *   · 核心暴露倍率用 `probeBossDamage()` 打固定 20 伤害、各取 5 次求和后比比值，
 *     暴击是随机但两次取样共享同一分布，所以比值仍收敛到 1.5；
 *   · 引力井的"真的会吸"用无输入 0.5s 内到井心的距离变化来判定。
 *
 * 用法：node tools/arcane_u4b.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9494;                 // U4b 专用端口
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail == null ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---------- 1) 静态守卫 ----------
  const source = fs.readFileSync(FILE, 'utf8');
  ok('结构就位：BOSS_SIG_CONFIG + updateBossSignature + coreOpen 伤害倍率',
    source.includes('const BOSS_SIG_CONFIG = {') && source.includes('function updateBossSignature(')
    && source.includes("id: 'overload'") && source.includes("id: 'runeChain'") && source.includes("id: 'gravityWell'")
    && source.includes('enemy.isBoss && enemy.coreOpen > 0'),
    { sig: source.includes('const BOSS_SIG_CONFIG = {') });

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 就绪 */ }
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
   * 全屏截图落盘
   * @param {string} name 文件名
   * @returns {string} 绝对路径
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, name);
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    return out;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  const btn = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
  await sleep(1500);

  // ---------- 2) 配置覆盖 ----------
  const audit = await ev(`window.__roamDebug.bossSigAudit()`);
  const kinds = audit.kinds;
  const ids = [kinds.mech.id, kinds.rune.id, kinds.void.id];
  ok('三个 Boss 各有一个 id 互不相同的招牌',
    ids.length === 3 && ids.every((x) => typeof x === 'string' && x.length > 0)
    && new Set(ids).size === 3 && audit.phase2CooldownMul === 0.75,
    { ids, phase2: audit.phase2CooldownMul });

  /**
   * 进入某一层的首领房，并等登场演出结束
   * @param {number} floor 楼层
   * @returns {Object|null} 首领房矩形
   */
  const enterBossRoom = async (floor) => {
    await ev(`window.__roamDebug.setFloor(${floor})`);
    await sleep(600);
    await ev(`window.__roamDebug.setHp(240)`);
    const room = await ev(`(function(){ var s = window.__roamDebug.bossState(); return s ? s.room : null; })()`);
    if (!room) return null;
    await ev(`window.__roamDebug.teleport(${room.cx - 120}, ${room.cy})`);
    await sleep(3200);   // 登场演出 2.3s + 余量 → started 为 true
    return room;
  };

  // ---------- 3) 机械：核心过载 ----------
  const mechRoom = await enterBossRoom(1);
  const mechBefore = await ev(`window.__roamDebug.bossSigState()`);
  const fired = await ev(`window.__roamDebug.forceBossSig()`);
  const mechTg = await ev(`window.__roamDebug.bossSigState()`);
  ok('机械招牌触发：前摇 1.0s 的环形预警',
    fired === true && mechTg.telegraph && mechTg.telegraph.kind === 'ring'
    && Math.abs(mechTg.telegraph.total - 1.0) < 0.05 && mechTg.telegraph.t > 0.9,
    { fired, telegraph: mechTg.telegraph });
  ok('招牌不抢重招轮转（attackIndex 不变）',
    mechBefore && mechTg && mechTg.attackIndex === mechBefore.attackIndex,
    { before: mechBefore && mechBefore.attackIndex, after: mechTg && mechTg.attackIndex });

  await sleep(1150);
  const coreOn = await ev(`window.__roamDebug.bossSigState()`);
  ok('前摇结算后进入核心暴露（coreOpen ≥ 2.0 / 受伤 ×1.5 / 移速 ×0.6）',
    coreOn.coreOpen >= 2.0 && coreOn.coreDamageMul === 1.5 && coreOn.coreSpeedMul === 0.6,
    { coreOpen: coreOn.coreOpen, dmgMul: coreOn.coreDamageMul, speedMul: coreOn.coreSpeedMul });

  const onSamples = await ev(`[0,1,2,3,4].map(function(){ return window.__roamDebug.probeBossDamage(20); })`);
  const shotPath = await shot('u4b-mech-core-open.png');

  // 等核心暴露结束再取关闭口径
  for (let i = 0; i < 30; i += 1) {
    const st = await ev(`window.__roamDebug.bossSigState()`);
    if (st.coreOpen <= 0) break;
    await sleep(120);
  }
  const offSamples = await ev(`[0,1,2,3,4].map(function(){ return window.__roamDebug.probeBossDamage(20); })`);
  const sumOn = onSamples.reduce((a, b) => a + (b || 0), 0);
  const sumOff = offSamples.reduce((a, b) => a + (b || 0), 0);
  const ratio = sumOff > 0 ? sumOn / sumOff : 0;
  ok('核心暴露期间同一发伤害血量掉落 ≥ 关闭时 ×1.4',
    ratio >= 1.4,
    { ratio: Number(ratio.toFixed(3)), on: onSamples, off: offSamples });

  // ---------- 4) 符文：连环刻印 ----------
  await enterBossRoom(2);
  const runeFired = await ev(`window.__roamDebug.forceBossSig()`);
  const runeState = await ev(`window.__roamDebug.bossSigState()`);
  const hazards = runeState.hazards || [];
  let minGap = Infinity;
  for (let i = 1; i < hazards.length; i += 1) {
    const d = Math.hypot(hazards[i].x - hazards[i - 1].x, hazards[i].y - hazards[i - 1].y);
    if (d < minGap) minGap = d;
  }
  ok('符文招牌：一次铺 3 个刻印、两两间距 ≥ 40',
    runeFired === true && hazards.length === 3 && minGap >= 40,
    { count: hazards.length, minGap: Number(minGap.toFixed(1)) });
  const ts = hazards.map((h) => Number(h.t.toFixed(2))).sort((a, b) => a - b);
  ok('三个刻印依次引爆（t 递增 0.5s，而不是同时）',
    ts.length === 3 && Math.abs(ts[1] - ts[0] - 0.5) < 0.06 && Math.abs(ts[2] - ts[1] - 0.5) < 0.06,
    { ts });

  // ---------- 5) 虚空：引力井 ----------
  const voidRoom = await enterBossRoom(3);
  const voidFired = await ev(`window.__roamDebug.forceBossSig()`);
  const voidState = await ev(`window.__roamDebug.bossSigState()`);
  ok('虚空招牌：1.6s 引力井（半径 150 / 吸力 150 / 22 伤害）',
    voidFired === true && voidState.telegraph
    && voidState.telegraph.kind === 'singularity'
    && Math.abs(voidState.telegraph.total - 1.6) < 0.05
    && voidState.telegraph.pull === 150 && voidState.telegraph.damage === 22,
    { telegraph: voidState.telegraph });

  const pullBefore = await ev(`(function(){
    var st = window.__roamDebug.bossSigState();
    if (!st || !st.telegraph) return null;
    var s = window.__roamDebug.getState();
    var c = st.telegraph;
    return { d: Math.hypot(s.player.x - c.x, s.player.y - c.y), x: s.player.x, y: s.player.y };
  })()`);
  await sleep(520);
  const pullAfter = await ev(`(function(){
    var st = window.__roamDebug.bossSigState();
    if (!st || !st.telegraph) return null;
    var s = window.__roamDebug.getState();
    var c = st.telegraph;
    return { d: Math.hypot(s.player.x - c.x, s.player.y - c.y), x: s.player.x, y: s.player.y };
  })()`);
  const shrink = (pullBefore && pullAfter) ? pullBefore.d - pullAfter.d : -1;
  ok('引力井真的会把玩家往中心拖（无输入 0.5s 内距离缩小 ≥ 30）',
    shrink >= 30, {
      before: pullBefore ? Number(pullBefore.d.toFixed(1)) : null,
      after: pullAfter ? Number(pullAfter.d.toFixed(1)) : null,
      shrink: Number(shrink.toFixed(1))
    });

  // ---------- 6) A/B 关闭 ----------
  await ev(`window.__roamDebug.setBossSig(false)`);
  const offAudit = await ev(`window.__roamDebug.bossSigAudit()`);
  const offFired = await ev(`window.__roamDebug.forceBossSig()`);
  const offState = await ev(`window.__roamDebug.bossSigState()`);
  ok('A/B 关闭后招牌不再触发（enabled=false / force=false / 无前摇无刻印）',
    offAudit.enabled === false && offFired === false
    && (!offState.telegraph) && offState.hazardCount === 0,
    { enabled: offAudit.enabled, fired: offFired, telegraph: offState.telegraph, hazards: offState.hazardCount });
  await ev(`window.__roamDebug.setBossSig(true)`);

  // ---------- 7) 性能 / 截图 ----------
  const perf = await ev(`new Promise(function(resolve){
    var frames = []; var last = performance.now(); var warm = 0;
    function tick(now){
      var dt = now - last; last = now;
      if (warm < 40) { warm += 1; } else { frames.push(dt); }
      if (frames.length >= 150) {
        var sum = 0; var max = 0;
        frames.forEach(function(d){ if (d > 0) { sum += d; if (d > max) max = d; } });
        var avg = sum / frames.length;
        resolve({ avgFps: Number((1000 / avg).toFixed(1)), minFps: Number((1000 / max).toFixed(1)),
          errors: window.__roamDebug.errors() });
      } else { requestAnimationFrame(tick); }
    }
    requestAnimationFrame(tick);
  })`);
  console.log('PERF · ' + JSON.stringify(perf));
  ok('avg fps ≥ 60（跳过首帧预热）', perf.avgFps >= 60, { avgFps: perf.avgFps, minFps: perf.minFps });
  ok('无运行时错误', perf.errors.length === 0, perf.errors);
  ok('核心暴露截图 >10KB（能看到金色核心环）',
    fs.existsSync(shotPath) && fs.statSync(shotPath).size > 10 * 1024,
    { file: path.basename(shotPath), size: fs.existsSync(shotPath) ? fs.statSync(shotPath).size : 0 });

  const passed = asserts.filter((a) => a.pass).length;
  console.log(`\nU4b · ${passed}/${asserts.length} PASS`);
  fs.writeFileSync(path.join(OUT_DIR, 'u4b-result.json'),
    JSON.stringify({ passed, total: asserts.length, asserts }, null, 2));

  try { ws.close(); } catch (e) { /* 忽略 */ }
  killEdge(edge);
  if (asserts.some((a) => !a.pass)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL · ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 150);
});
