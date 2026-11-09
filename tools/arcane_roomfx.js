/**
 * 第 6 轮 · 第 1 组验收：分房型演出强度分级
 * ------------------------------------------------------------
 * 覆盖：
 *   A1 配置齐全（普通战斗 maxTier=1 / 首领白名单只放阶段切换·破盾·击杀）
 *   A2 普通战斗房：清房/精英击杀一律压到 S1，S2 计数为 0
 *   A3 精英房：里程碑事件可放行 S2，且震幅大于普通战斗房
 *   A4 首领房：连击阈值/多杀压到 S1，阶段切换/破盾/击杀放行 S2
 *   A5 首领房同样遵守"1 秒内 S2 ≤1 次"
 *   A6 三房型 S0/S1/S2 计数表差异明显
 *   A7 可读性：粒子被推到玩家 90px 外、震幅 ≤ 视野 1.2%
 *   A8 阶段切换三拍：0/0.24/0.56 依次落，过程中不新增 S2
 *   A9 首领击杀帧不叠粒子（suppressBurst）
 *   A10 before / after 截图各 1 张
 *
 * 用法：node tools/arcane_roomfx.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9762;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'roomfx');
const RESULTS = path.join(OUT, 'roomfx-result.json');

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

  /** 统一布置：第 6 层（同时存在 battle / elite / boss 三种房型），停表后手动组帧 */
  const setup = () => ev(`(() => {
    __roamDebug.xp.setEnabled(false);
    __roamDebug.enemies.floor(6);
    state.mode = 'playing'; state.status = 'playing';
    state.player.invuln = 999;
    state.elapsed = 100;
    __roamDebug.roomfx.reset();
    __roamDebug.fxtier.reset();
    return { rooms: __roamDebug.roomfx.rooms() };
  })()`);
  await ev(`(() => { window.__rafOrig = window.requestAnimationFrame; window.requestAnimationFrame = function () { return 0; }; return true; })()`);
  const boot = await setup();

  // ---------- A1：配置 ----------
  const cfg = await ev(`__roamDebug.roomfx.info().config`);
  check('A1 房型档位配置齐全（战斗只放连击阈值 / 首领只放三件事）',
    cfg.battle.maxTier === 2 && cfg.battle.s2Kinds.join(',') === 'comboThreshold'
    && cfg.elite.s2Kinds.indexOf('eliteKill') >= 0
    && cfg.boss.s2Kinds.join(',') === 'bossPhase,bossBreak,bossKill'
    && cfg.fallback.s2Kinds === null,
    { battle: cfg.battle, boss: cfg.boss.s2Kinds });

  // ---------- A2：普通战斗房压档 ----------
  await setup();
  const battleRun = await ev(`(() => {
    const room = __roamDebug.roomfx.enter('battle');
    __roamDebug.roomfx.reset();
    __roamDebug.fxtier.reset();
    const trace = [];
    const kinds = ['roomClear', 'eliteKill', 'multiKill', 'aoe5', 'descend'];
    for (let i = 0; i < 12; i += 1) {
      state.elapsed += 1.2;
      const f = __roamDebug.fxtier.emit(kinds[i % kinds.length], { x: state.player.x, y: state.player.y });
      trace.push({ kind: kinds[i % kinds.length], tier: f.tier, capped: f.capped, reason: f.reason });
    }
    return { room: room, trace: trace.slice(0, 4), stats: __roamDebug.roomfx.info().stats,
      fx: __roamDebug.fxtier.audit().stats };
  })()`);
  check('A2 普通战斗房：里程碑事件全部压到 S1，S2 计数为 0',
    battleRun.stats.battle.s2 === 0 && battleRun.stats.battle.s1 === 12
    && battleRun.stats.battle.capped >= 6 && battleRun.fx.s2 === 0,
    { bucket: battleRun.stats.battle, fx: battleRun.fx, trace: battleRun.trace });

  const battleThreshold = await ev(`(() => {
    __roamDebug.roomfx.enter('battle');
    state.elapsed += 1.2;
    return __roamDebug.fxtier.emit('comboThreshold', { x: state.player.x, y: state.player.y });
  })()`);
  check('A2b 普通战斗房的连击阈值仍放行 S2（稀有里程碑不被误伤）',
    battleThreshold.tier === 'S2' && battleThreshold.capped === false
    && battleThreshold.reason === 'comboThreshold',
    { tier: battleThreshold.tier, capped: battleThreshold.capped, reason: battleThreshold.reason });

  // ---------- A3：精英房放行 + 震幅对比 ----------
  await setup();
  const eliteRun = await ev(`(() => {
    // 先量普通战斗房的 S2 震幅（应被压到 S1 的 3.0 * 0.82 ≈ 2.5）
    const b = __roamDebug.roomfx.enter('battle');
    __roamDebug.fxtier.reset(); state.elapsed = 100;
    const fBattle = __roamDebug.fxtier.emit('eliteKill', { x: state.player.x, y: state.player.y });
    // 再切精英房，同一事件应放行 S2
    const e = __roamDebug.roomfx.enter('elite');
    __roamDebug.fxtier.reset(); state.elapsed = 101;
    const fElite = __roamDebug.fxtier.emit('eliteKill', { x: state.player.x, y: state.player.y });
    state.elapsed = 102.2;
    const fSecond = __roamDebug.fxtier.emit('roomClear', { x: state.player.x, y: state.player.y });
    return { battleRoom: b, eliteRoom: e, fBattle: fBattle, fElite: fElite, fSecond: fSecond,
      stats: __roamDebug.roomfx.info().stats };
  })()`);
  check('A3 精英房：精英击杀/清房放行 S2（两次窗口间隔后可再来一次）',
    eliteRun.fElite.tier === 'S2' && eliteRun.fSecond.tier === 'S2'
    && eliteRun.stats.elite.s2 === 2,
    { first: eliteRun.fElite.tier, second: eliteRun.fSecond.tier, bucket: eliteRun.stats.elite });
  check('A3b 普通战斗房同一事件被压档且震幅更小',
    eliteRun.fBattle.tier === 'S1' && eliteRun.fBattle.capped === true
    && eliteRun.fBattle.shake < eliteRun.fElite.shake,
    { battle: { tier: eliteRun.fBattle.tier, shake: eliteRun.fBattle.shake },
      elite: { tier: eliteRun.fElite.tier, shake: eliteRun.fElite.shake } });

  // ---------- A4：首领房白名单 ----------
  await setup();
  const bossRun = await ev(`(() => {
    const room = __roamDebug.roomfx.enter('boss');
    __roamDebug.roomfx.reset();
    __roamDebug.fxtier.reset();
    state.elapsed = 200;
    const cap1 = __roamDebug.fxtier.emit('comboThreshold', { x: 1, y: 1 });
    state.elapsed = 200.4;
    const cap2 = __roamDebug.fxtier.emit('multiKill', { x: 1, y: 1 });
    state.elapsed = 201.6;
    const phase = __roamDebug.fxtier.emit('bossPhase', { x: 1, y: 1 });
    state.elapsed = 202.8;
    const brk = __roamDebug.fxtier.emit('bossBreak', { x: 1, y: 1 });
    state.elapsed = 204.0;
    const kill = __roamDebug.fxtier.emit('bossKill', { x: 1, y: 1, suppressBurst: true });
    return { room: room, cap1: cap1, cap2: cap2, phase: phase, brk: brk, kill: kill,
      stats: __roamDebug.roomfx.info().stats, bossFx: __roamDebug.roomfx.info().bossFx };
  })()`);
  check('A4 首领房：连击阈值/多杀压到 S1（reason 记入 capped）',
    bossRun.cap1.tier === 'S1' && bossRun.cap1.capped === true
    && bossRun.cap2.tier === 'S1' && bossRun.cap2.capped === true
    && bossRun.stats.boss.capped === 2,
    { cap1: bossRun.cap1, cap2: bossRun.cap2, bucket: bossRun.stats.boss });
  check('A4b 首领房：阶段切换 / 破盾 / 击杀三次里程碑都放行 S2',
    bossRun.phase.tier === 'S2' && bossRun.brk.tier === 'S2' && bossRun.kill.tier === 'S2'
    && bossRun.stats.boss.s2 === 3,
    { phase: bossRun.phase.tier, brk: bossRun.brk.tier, kill: bossRun.kill.tier,
      bucket: bossRun.stats.boss });
  check('A4c 首领击杀帧不叠加分档粒子（保留专属 44+26 爆点）',
    bossRun.kill.particles === 0 && bossRun.kill.bursts === 0,
    { particles: bossRun.kill.particles, bursts: bossRun.kill.bursts });

  // ---------- A5：首领房 S2 节流 ----------
  await setup();
  const throttle = await ev(`(() => {
    __roamDebug.roomfx.enter('boss');
    __roamDebug.roomfx.reset();
    __roamDebug.fxtier.reset();
    state.elapsed = 300;
    let first = null;
    for (let i = 0; i < 10; i += 1) {
      const f = __roamDebug.fxtier.emit('bossPhase', { x: 1, y: 1 });
      if (i === 0) first = f;
    }
    const audit = __roamDebug.fxtier.audit();
    state.elapsed = 302.5;
    __roamDebug.fxtier.emit('bossPhase', { x: 1, y: 1 });
    return { first: first, inside: audit.stats, after: __roamDebug.fxtier.audit().stats };
  })()`);
  check('A5 首领房 1 秒内 10 次阶段事件 → 仅 1 次 S2，其余合并',
    throttle.first.tier === 'S2' && throttle.inside.s2 === 1 && throttle.inside.s2Merged === 9,
    { inside: throttle.inside, first: throttle.first });
  check('A5b 跨过 1 秒窗口后允许再次 S2',
    throttle.after.s2 === 2,
    throttle.after);

  // ---------- A6：三房型分布表 ----------
  await setup();
  const table = await ev(`(() => {
    const out = {};
    ['battle', 'elite', 'boss'].forEach((type) => {
      __roamDebug.roomfx.enter(type);
      __roamDebug.roomfx.reset();
      __roamDebug.fxtier.reset();
      state.elapsed = 400;
      for (let i = 0; i < 20; i += 1) {
        state.elapsed += 1.2;
        __roamDebug.fxtier.emit('multiKill', { x: 1, y: 1 });
      }
      const s = __roamDebug.roomfx.info().stats;
      out[type] = { s0: s[type].s0, s1: s[type].s1, s2: s[type].s2, capped: s[type].capped };
    });
    return out;
  })()`);
  const diffOk = table.battle.s2 === 0 && table.elite.s2 === 20 && table.boss.s2 === 0
    && table.battle.s1 === 20 && table.boss.s1 === 20 && table.elite.s1 === 0;
  check('A6 三房型 20 次"多杀"分布差异明显（战斗/首领 0 次 S2，精英 20 次）', diffOk, table);

  // ---------- A7：可读性硬约束 ----------
  await setup();
  const readability = await ev(`(() => {
    __roamDebug.roomfx.enter('boss');
    __roamDebug.fxtier.reset();
    state.elapsed = 500;
    __roamDebug.despawnAll();
    const type = Object.keys(ENEMY_CONFIG)[0];
    const px = state.player.x;
    const py = state.player.y;
    __roamDebug.spawnEnemyAt(type, px + 10, py, { roomId: state.currentRoomId });
    __roamDebug.spawnEnemyAt(type, px - 10, py, { roomId: state.currentRoomId });
    __roamDebug.spawnEnemyAt(type, px, py + 10, { roomId: state.currentRoomId });
    const ids = state.enemies.slice(0, 3).map((e) => e.id);
    const r = __roamDebug.fxtier.damageAll(ids, 99999);
    const span = cameraSpan();
    const cap = Math.min(span.w, span.h) * 0.5 * 0.012;
    const d = Math.hypot(r.frame.burstX - state.player.x, r.frame.burstY - state.player.y);
    return { frame: r.frame, dist: Math.round(d), cap: Number(cap.toFixed(2)),
      view: { w: Math.round(span.w), h: Math.round(span.h) } };
  })()`);
  check('A7 爆发点被推到玩家 90px 安全圈外', readability.dist >= 90,
    { dist: readability.dist, safeRadius: 90 });
  check('A7b 单帧震幅 ≤ 视野半径 1.2%', readability.frame.shake <= readability.cap + 0.1,
    { shake: readability.frame.shake, cap: readability.cap, view: readability.view });

  // ---------- A8：首领阶段三拍 ----------
  await setup();
  const ceremony = await ev(`(() => {
    __roamDebug.roomfx.enter('boss');
    __roamDebug.roomfx.reset();
    __roamDebug.fxtier.reset();
    state.elapsed = 600;
    const start = __roamDebug.roomfx.ceremonyTest();
    const s2Before = __roamDebug.fxtier.audit().stats.s2;
    const marks = [];
    for (let i = 0; i < 62; i += 1) {
      state.mode = 'playing'; state.status = 'playing'; state.player.invuln = 999;
      update(1 / 60);
      const info = __roamDebug.roomfx.info();
      if (info.ceremony && info.ceremony.played !== (marks.length ? marks[marks.length - 1].played : 0)) {
        marks.push({ t: info.ceremony.t, played: info.ceremony.played });
      }
    }
    const s2After = __roamDebug.fxtier.audit().stats.s2;
    return { start: start.ceremony, marks: marks, bossFx: __roamDebug.roomfx.info().bossFx,
      s2Before: s2Before, s2After: s2After, ended: __roamDebug.roomfx.info().ceremony };
  })()`);
  const gaps = ceremony.marks.map((m, i) => (i === 0
    ? m.t
    : Number((m.t - ceremony.marks[i - 1].t).toFixed(3))));
  check('A8 阶段切换三拍按 0/0.24/0.56 依次落下',
    ceremony.marks.length === 3 && ceremony.bossFx.beats === 3 && ceremony.bossFx.ceremonies === 1
    && gaps[0] < 0.02 && gaps[1] >= 0.18 && gaps[2] >= 0.18,
    { marks: ceremony.marks, gaps: gaps, bossFx: ceremony.bossFx });
  check('A8b 三拍全程不新增 S2（节拍只走世界层）',
    ceremony.s2After === ceremony.s2Before && ceremony.ended === null,
    { s2Before: ceremony.s2Before, s2After: ceremony.s2After, ended: ceremony.ended });

  // ---------- A9：截图 before / after ----------
  await setup();
  await ev(`(() => {
    __roamDebug.roomfx.enter('boss');
    __roamDebug.despawnAll();
    __roamDebug.roomfx.reset();
    update(1 / 60); render();
    return true;
  })()`);
  await shot('roomfx-before.png');
  await ev(`(() => {
    __roamDebug.roomfx.ceremonyTest();
    // 推进到第 2 拍附近（0.30s）：主体环 + 26 粒子已落地
    for (let i = 0; i < 19; i += 1) {
      state.mode = 'playing'; state.status = 'playing'; state.player.invuln = 999;
      update(1 / 60);
    }
    render();
    return __roamDebug.roomfx.info().ceremony;
  })()`);
  await shot('roomfx-after.png');

  // 恢复 RAF
  await ev(`(() => { if (window.__rafOrig) { window.requestAnimationFrame = window.__rafOrig; requestAnimationFrame(loop); } return true; })()`);
  await sleep(200);

  fs.writeFileSync(RESULTS, JSON.stringify({
    at: new Date().toISOString(), boot, checks,
    screenshots: ['roomfx-before.png', 'roomfx-after.png'], runtimeErrors
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
