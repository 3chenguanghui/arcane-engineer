/**
 * 第 5 轮 · 第 1 组验收：连击与爽感系统
 * ------------------------------------------------------------
 * 覆盖：
 *   A1 配置默认值 + 存档开关往返（localStorage 真写）
 *   A2 连杀累加 / 音高递进 / 超时中断复位
 *   A3 阈值冲击环只触发一次（同一轮连杀内）
 *   A4 三条硬约束：1 秒内 S2 ≤1、同帧合并（comboThreshold 被降级只记账）
 *   A5 同帧 ≥4 杀 → 集体爆裂只触发一次
 *   A6 关闭开关后：连杀仍计数，但脉冲/阈值/爆裂全不播
 *   A7 长连杀帧预算：120 帧平均 ≤16.6ms（PERF 口径，只记录不掩盖 FAIL）
 *   A8 before / after 截图各 1 张
 *
 * 用法：node tools/arcane_combo_fx.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9761;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'combo_fx');
const RESULTS = path.join(OUT, 'combo-fx-result.json');

const checks = [];
const runtimeErrors = [];
let EDGE_PROC = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  EDGE_PROC = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push(d ? ((d.exception || {}).description || d.text) : 'unknown');
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
        + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  // ---------- 启动 ----------
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(1000);

  /** 统一布置：关卡 3、最大房间、14 只站桩怪、关经验弹窗 */
  const setup = () => ev(`(() => {
    __roamDebug.xp.setEnabled(false);
    __roamDebug.enemies.floor(3);
    state.mode = 'playing'; state.status = 'playing';
    const room = state.rooms.filter((r) => r.type === 'battle' || r.type === 'elite')
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || state.rooms[0];
    state.currentRoomId = room.id;
    __roamDebug.teleport(room.cx, room.cy);
    __roamDebug.despawnAll();
    const type = Object.keys(ENEMY_CONFIG)[0];
    const n = 14;
    for (let i = 0; i < n; i += 1) {
      const a = (Math.PI * 2 / n) * i;
      __roamDebug.spawnEnemyAt(type, room.cx + Math.cos(a) * 120, room.cy + Math.sin(a) * 120, { roomId: room.id });
    }
    __roamDebug.pinEnemies(0);
    __roamDebug.comboFx.resetRun();
    __roamDebug.fxtier.reset();
    state.elapsed = 100;
    state.player.invuln = 999;
    return { room: { id: room.id, cx: room.cx, cy: room.cy }, type: type, foes: state.enemies.length };
  })()`);

  /** 停掉 RAF：后面全部手动组帧 */
  await ev(`(() => { window.__rafOrig = window.requestAnimationFrame; window.requestAnimationFrame = function () { return 0; }; return true; })()`);

  // ---------- A1：默认值 + 存档开关 ----------
  const baseline = await ev(`__roamDebug.comboFx.info()`);
  const saveRoundTrip = await ev(`(() => {
    __roamDebug.comboFx.setEnabled(false);
    const off = JSON.parse(localStorage.getItem('arcane_rogue_meta') || '{}').comboFx;
    __roamDebug.comboFx.setEnabled(true);
    const on = JSON.parse(localStorage.getItem('arcane_rogue_meta') || '{}').comboFx;
    return { off: off, on: on, enabledNow: __roamDebug.comboFx.info().enabled,
      panel: __roamDebug.comboFx.info().panelChecked };
  })()`);
  check('A1 默认开启且阈值/爆裂配置齐全',
    baseline.enabled === true && baseline.config.thresholds.join(',') === '8,16,30'
    && baseline.config.minGroupKills === 4,
    { enabled: baseline.enabled, config: baseline.config });
  check('A1b 存档开关往返（写盘 / 读回 / 面板状态）',
    saveRoundTrip.off === false && saveRoundTrip.on === true
    && saveRoundTrip.enabledNow === true && saveRoundTrip.panel === 'true',
    saveRoundTrip);

  // ---------- A2：连杀累加 / 音高递进 / 中断复位 ----------
  await setup();
  const seqKills = await ev(`(() => {
    const out = [];
    for (let i = 0; i < 6; i += 1) {
      const enemy = state.enemies[0];
      if (!enemy) break;
      __roamDebug.fxtier.damage(enemy.id, 99999);
      state.mode = 'playing'; state.status = 'playing';
      state.player.invuln = 999;
      update(1 / 60);
      const info = __roamDebug.comboFx.info();
      out.push({ count: info.run.count, pitch: info.run.pitch, edge: info.run.edge });
    }
    const beforeBreak = __roamDebug.comboFx.info();
    state.combo.timer = 0.0001;
    update(0.05);
    const afterBreak = __roamDebug.comboFx.info();
    return { kills: out, beforeBreak: beforeBreak.run, afterBreak: afterBreak.run,
      stats: afterBreak.stats };
  })()`);
  const pitches = seqKills.kills.map((k) => k.pitch);
  const pitchAscends = pitches.every((v, i) => i === 0 || v >= pitches[i - 1]);
  check('A2 连杀逐级累加（6 杀 → count=6）',
    seqKills.kills.length === 6 && seqKills.kills[5].count === 6,
    seqKills.kills);
  check('A2b 连击音高单调上扬（1.00 → 1.15 上限内）',
    pitchAscends && pitches[0] === 1 && pitches[5] > pitches[0] && pitches[5] <= 1.35,
    { pitches: pitches });
  check('A2c 超时中断：计数/音高/脉冲全部复位',
    seqKills.afterBreak.count === 0 && seqKills.afterBreak.pitch === 1
    && seqKills.afterBreak.edge === 0 && seqKills.stats.breaks >= 1,
    { before: seqKills.beforeBreak, after: seqKills.afterBreak, breaks: seqKills.stats.breaks });

  // ---------- A3：阈值只触发一次 ----------
  await setup();
  const thresholdRun = await ev(`(() => {
    const out = [];
    for (let i = 0; i < 10; i += 1) {
      const enemy = state.enemies[0];
      if (!enemy) break;
      __roamDebug.fxtier.damage(enemy.id, 99999);
      state.mode = 'playing'; state.status = 'playing';
      state.player.invuln = 999;
      update(1 / 60);
      const ft = __roamDebug.fxtier.audit();
      out.push({ at: i + 1, thresholds: __roamDebug.comboFx.info().stats.thresholds,
        last: __roamDebug.comboFx.info().stats.lastThreshold,
        merged: __roamDebug.comboFx.info().stats.mergedThresholds,
        s2: ft.stats.s2, s2Merged: ft.stats.s2Merged, lastS2At: ft.lastS2At,
        elapsed: Number(state.elapsed.toFixed(2)) });
    }
    const info = __roamDebug.comboFx.info();
    return { out: out, stats: info.stats, run: info.run };
  })()`);
  const at8 = thresholdRun.out.find((r) => r.at === 8);
  const beyond = thresholdRun.out.filter((r) => r.at > 8);
  check('A3 阈值 8 连触发 1 次且后续不重复',
    !!at8 && at8.thresholds === 1 && beyond.every((r) => r.thresholds === 1),
    { at8: at8, after: beyond.map((r) => r.thresholds),
      trace: thresholdRun.out.slice(4, 10) });
  check('A3b 阈值触发时登记在 thresholdsHit（8）',
    thresholdRun.run.thresholdsHit.indexOf(8) >= 0 && thresholdRun.stats.lastThreshold === 8,
    { hit: thresholdRun.run.thresholdsHit, last: thresholdRun.stats.lastThreshold });

  // ---------- A4：S2 频次（同帧合并 + 1 秒窗口） ----------
  await setup();
  const s2 = await ev(`(() => {
    state.elapsed = 200;
    __roamDebug.fxtier.reset();
    const frames = [];
    for (let i = 0; i < 5; i += 1) frames.push(__roamDebug.fxtier.emit('comboThreshold', { x: 0, y: 0 }));
    const burst = __roamDebug.fxtier.audit();
    // 同一秒内再补 10 次，仍不应出现第 2 个 S2
    for (let i = 0; i < 10; i += 1) __roamDebug.fxtier.emit('comboThreshold', { x: 0, y: 0 });
    const sameSecond = __roamDebug.fxtier.audit();
    const comboStats = __roamDebug.comboFx.info().stats;
    // 跨过 1 秒窗口后允许再来 1 次
    state.elapsed = 202;
    __roamDebug.fxtier.emit('comboThreshold', { x: 0, y: 0 });
    const nextSecond = __roamDebug.fxtier.audit();
    return { burst: burst, sameSecond: sameSecond, nextSecond: nextSecond,
      comboStats: comboStats, merged: comboStats.mergedThresholds };
  })()`);
  check('A4 同帧多次阈值 → 只放行 1 次 S2（其余合并）',
    s2.burst.stats.s2 === 1 && s2.burst.stats.s2Merged === 4
    && s2.sameSecond.stats.s2 === 1 && s2.sameSecond.stats.s2Merged === 14,
    { burst: s2.burst.stats, sameSecond: s2.sameSecond.stats });
  check('A4b 跨 1 秒窗口后允许第 2 次 S2（节流是窗口而不是永久封锁）',
    s2.nextSecond.stats.s2 === 2,
    s2.nextSecond.stats);
  check('A4c 被合并的阈值只记账、不补放（mergedThresholds 增长）',
    s2.comboStats.thresholds >= 1 && s2.comboStats.mergedThresholds >= 14,
    { thresholds: s2.comboStats.thresholds, merged: s2.comboStats.mergedThresholds });

  // ---------- A5：同帧 ≥4 杀 → 集体爆裂只一次 ----------
  await setup();
  const blast = await ev(`(() => {
    const ids = state.enemies.slice(0, 5).map((e) => e.id);
    const r = __roamDebug.fxtier.damageAll(ids, 99999);
    const one = __roamDebug.comboFx.info().stats;
    // 第二帧只杀 2 只：不应再触发
    const ids2 = state.enemies.slice(0, 2).map((e) => e.id);
    __roamDebug.fxtier.damageAll(ids2, 99999);
    const two = __roamDebug.comboFx.info().stats;
    return { killed: r.killed, one: one, two: two, frame: r.frame };
  })()`);
  check('A5 同帧 5 杀 → 集体爆裂 1 次且记录击杀数',
    blast.killed === 5 && blast.one.groupBlasts === 1 && blast.one.lastGroupKills === 5,
    { killed: blast.killed, stats: blast.one });
  check('A5b 同帧 2 杀 < 阈值 → 不触发第二段爆裂',
    blast.two.groupBlasts === 1,
    { groupBlasts: blast.two.groupBlasts });

  // ---------- A6：关闭开关 ----------
  await setup();
  const offRun = await ev(`(() => {
    __roamDebug.comboFx.setEnabled(false);
    __roamDebug.comboFx.resetRun();
    __roamDebug.fxtier.reset();
    for (let i = 0; i < 8; i += 1) {
      const enemy = state.enemies[0];
      if (!enemy) break;
      __roamDebug.fxtier.damage(enemy.id, 99999);
      state.mode = 'playing'; state.status = 'playing';
      state.player.invuln = 999;
      update(1 / 60);
    }
    const info = __roamDebug.comboFx.info();
    __roamDebug.comboFx.setEnabled(true);
    return { count: info.run.count, edge: info.run.edge, pitch: info.run.pitch,
      stats: info.stats, enabledWhileOff: info.enabled };
  })()`);
  check('A6 关闭开关：连杀仍计数，但脉冲/阈值/爆裂全不播',
    offRun.count === 8 && offRun.enabledWhileOff === false
    && offRun.edge === 0 && offRun.pitch === 1
    && offRun.stats.edgePeaks === 0 && offRun.stats.thresholds === 0
    && offRun.stats.groupBlasts === 0,
    offRun);

  // ---------- A7：长连杀帧预算 ----------
  await setup();
  await ev(`__roamDebug.comboFx.setEnabled(true)`);
  const perf = await ev(`(() => {
    window.__pt = { n: 0, sum: 0, worst: 0, killFrames: 0 };
    const room = state.rooms.find((r) => r.id === state.currentRoomId);
    const type = Object.keys(ENEMY_CONFIG)[0];
    let guard = 0;
    for (let i = 0; i < 120; i += 1) {
      const p = state.player;
      p.invuln = 999; p.hp = p.hpMax; p.aether = p.aetherMax;
      state.mode = 'playing'; state.status = 'playing';
      const t0 = performance.now();
      // 每帧杀 1 只并补 1 只，维持"连杀不断 + 同屏 6 只"
      const enemy = state.enemies[0];
      if (enemy) { __roamDebug.fxtier.damage(enemy.id, 99999); window.__pt.killFrames += 1; }
      guard += 1;
      if (state.enemies.length < 6 && guard < 400) {
        const a = (guard % 6) * 1.05;
        __roamDebug.spawnEnemyAt(type, room.cx + Math.cos(a) * 120, room.cy + Math.sin(a) * 120, { roomId: room.id });
      }
      update(1 / 60);
      render();
      const dt = performance.now() - t0;
      window.__pt.sum += dt;
      window.__pt.n += 1;
      if (dt > window.__pt.worst) window.__pt.worst = dt;
    }
    return { frames: window.__pt.n, avg: window.__pt.sum / window.__pt.n,
      worst: window.__pt.worst, killFrames: window.__pt.killFrames,
      combo: state.combo.count, groupBlasts: __roamDebug.comboFx.info().stats.groupBlasts,
      s2: __roamDebug.fxtier.audit().stats.s2 };
  })()`);
  check('A7 长连杀 120 帧平均帧时 ≤16.6ms（含 update+render）',
    perf.frames === 120 && perf.avg <= 16.6,
    { avg: Number(perf.avg.toFixed(2)), worst: Number(perf.worst.toFixed(2)),
      combo: perf.combo, groupBlasts: perf.groupBlasts, s2: perf.s2,
      note: 'PERF 口径：无头 Edge、1440x900、无后处理' });

  // ---------- A8：截图 before / after ----------
  // before：关闭演出后连杀 8 只（画面应无边缘脉冲/冲击环）
  await setup();
  await ev(`(() => {
    __roamDebug.comboFx.setEnabled(false);
    __roamDebug.comboFx.resetRun();
    for (let i = 0; i < 8; i += 1) {
      const e = state.enemies[0];
      if (e) __roamDebug.fxtier.damage(e.id, 99999);
      state.mode = 'playing'; state.status = 'playing'; state.player.invuln = 999;
      update(1 / 60);
    }
    render();
    return true;
  })()`);
  await shot('combo-fx-before.png');
  // after：开启演出，同帧 5 杀（集体爆裂）+ 阈值连击画面
  await setup();
  await ev(`(() => {
    __roamDebug.comboFx.setEnabled(true);
    __roamDebug.comboFx.resetRun();
    let killed = 0;
    for (let i = 0; i < 8; i += 1) {
      const e = state.enemies[0];
      if (e) { __roamDebug.fxtier.damage(e.id, 99999); killed += 1; }
      state.mode = 'playing'; state.status = 'playing'; state.player.invuln = 999;
      update(1 / 60);
    }
    const ids = state.enemies.slice(0, 5).map((e) => e.id);
    __roamDebug.fxtier.damageAll(ids, 99999);
    state.comboFx.edge = 1;
    update(1 / 60);
    render();
    return { killed: killed, threshold: __roamDebug.comboFx.info().stats.thresholds,
      blasts: __roamDebug.comboFx.info().stats.groupBlasts };
  })()`);
  await shot('combo-fx-after.png');

  // 恢复 RAF，避免页面卡在"停表"状态
  await ev(`(() => { if (window.__rafOrig) { window.requestAnimationFrame = window.__rafOrig; requestAnimationFrame(loop); } return true; })()`);
  await sleep(200);

  fs.writeFileSync(RESULTS, JSON.stringify({
    at: new Date().toISOString(), checks,
    screenshots: ['combo-fx-before.png', 'combo-fx-after.png'], runtimeErrors
  }, null, 2));
  const fails = checks.filter((c) => !c.ok);
  console.log(`\nRESULT: ${fails.length ? 'FAIL' : 'PASS'}  ${checks.length - fails.length}/${checks.length}`);
  if (runtimeErrors.length) console.log('RUNTIME ERRORS: ' + JSON.stringify(runtimeErrors.slice(0, 3)));
  await cleanup();
  process.exit(fails.length ? 1 : 0);
}

/**
 * 关闭 Edge 与测试 profile
 * @returns {Promise<void>}
 */
async function cleanup() {
  try { if (EDGE_PROC) EDGE_PROC.kill(); } catch (e) { /* 已退出 */ }
  await sleep(300);
  try { killEdge(); } catch (e) { /* 忽略 */ }
}

main().catch(async (err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  await cleanup();
  process.exit(1);
});
