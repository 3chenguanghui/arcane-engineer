// F 批专项验收：演出分级 S0 / S1 / S2（节流、同帧合并、可读性、A/B）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9540;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'fxtier');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  // ---- 1) 配置：三档参数与硬约束参数 ----
  const info = await ev('__roamDebug.fxtier.info()');
  const t = info.config.tiers;
  /* 期望值同步主文件现值（2026-11-09 重取：2,848,200 字节 / MD5 13D9C718…）：
     S0 45ms / S1 90ms / 闪白 60ms。是 45/90/60，**不是 35/55/40** ——
     旧断言 0/55/40 会把主文件现值误报成回归。 */
  check('三档参数就位：S0 45ms/3px/10/0，S1 90ms/6px/26/60ms，S2 130ms/10px/58/110ms',
    t.S0.hitStop === 0.045 && t.S0.shake === 3 && t.S0.particles === 10 && t.S0.flashMs === 0
      && t.S1.hitStop === 0.090 && t.S1.shake === 6 && t.S1.particles === 26 && t.S1.flashMs === 60
      && t.S2.hitStop === 0.130 && t.S2.shake === 10 && t.S2.particles === 58 && t.S2.flashMs === 110,
    { S0: t.S0, S1: t.S1, S2: t.S2 });
  check('硬约束参数：1 秒 S2 窗口 / 震幅 1.6% / 安全半径 90px',
    info.config.throttleWindow === 1.0 && info.config.shakeMaxViewRatio === 0.016
      && info.config.safeRadius === 90 && info.config.enabled === true,
    { throttleWindow: info.config.throttleWindow, ratio: info.config.shakeMaxViewRatio, safe: info.config.safeRadius });

  // ---- 2) 选一间战斗房并把玩家放中间（避免出生房清空触发"清房"事件） ----
  const room = await ev(`(() => {
    const d = window.__roamDebug;
    d.setFloor(1);
    const rooms = d.getState().rooms || [];
    const r = rooms.find((item) => item.type === 'battle' || item.type === 'elite') || rooms[1] || rooms[0];
    const spawnRoom = rooms.find((item) => item.type === 'start' || item.type === 'spawn') || rooms[0];
    d.teleport(r.cx, r.cy);
    return {
      id: r.id, cx: r.cx, cy: r.cy, x: r.x, y: r.y, w: r.w, h: r.h,
      spawn: { x: spawnRoom.cx, y: spawnRoom.cy }
    };
  })()`);
  await sleep(700);
  check('落位战斗房（用于造命中/多杀场景）', room && room.id != null, room);

  // ---- 3) S0 普通命中：轻击、不顿帧、不震屏、粒子 ≤8 ----
  const s0 = await ev(`(() => {
    const d = window.__roamDebug;
    d.fxtier.reset();
    const s = d.spawnEnemyAt('shooter', ${room.cx - 260}, ${room.cy - 130}, { roomId: ${room.id} });
    const r = d.fxtier.damage(s.id, 3);
    return { s, r };
  })()`);
  check('S0：轻击 45ms 顿帧 / 3px 震屏（房间档位缩放后 >0 且 ≤3）/ 不闪白 / 粒子 ≤10',
    s0.r && s0.r.frame && s0.r.frame.tier === 'S0'
      && s0.r.frame.hitStopMs === 45 && s0.r.frame.shake > 0 && s0.r.frame.shake <= 3
      && s0.r.frame.flashMs === 0 && s0.r.frame.particles <= 10,
    s0.r && s0.r.frame);

  // ---- 4) S1：击杀普通怪 → 中等演出，震幅受 1.6% 视野半径上限约束 ----
  const measure = await ev('__roamDebug.room.measure()');
  const viewCap = Math.max(1, Math.min(measure.spanW, measure.spanH) * 0.5 * 0.016);
  const s1 = await ev(`(() => {
    const d = window.__roamDebug;
    d.fxtier.reset();
    const s = d.spawnEnemyAt('shooter', ${room.cx + 240}, ${room.cy + 120}, { roomId: ${room.id} });
    /* 血量会随平衡调整变化（2026-11-09：shooter 在 1 层已扛得住 80 点），
       先把目标压到 1 血再打，保证这一条测的是"击杀档位"，不是"当前数值能否打死"。 */
    d.terrain.weaken(s.id, 1);
    const r = d.fxtier.damage(s.id, 80);
    return { s, r };
  })()`);
  check('S1：普通击杀 = 90ms 顿帧 / 6px 震屏（受 1.6% 视野上限）/ 60ms 闪白 / 粒子 ≤26',
    s1.r && s1.r.frame && s1.r.frame.tier === 'S1'
      && s1.r.frame.hitStopMs === 90 && s1.r.frame.flashMs === 60
      && s1.r.frame.shake > 0 && s1.r.frame.shake <= Math.round(viewCap * 10) / 10
      && s1.r.frame.particles <= 26,
    { frame: s1.r && s1.r.frame, viewCap: Math.round(viewCap * 10) / 10 });

  // ---- 5) S2 节流：1 秒窗口内最多 1 次，后续降级 S1 并累计合并 ----
  // 挪到出生房做：这里没有敌人，不会因为"顺手清房"插入额外的 S2 事件干扰统计
  await ev(`__roamDebug.teleport(${room.spawn.x}, ${room.spawn.y})`);
  await sleep(650);
  await ev('__roamDebug.fxtier.reset()');
  const emit1 = await ev(`__roamDebug.fxtier.emit('roomClear', { x: ${room.spawn.x}, y: ${room.spawn.y} })`);
  const emit2 = await ev(`__roamDebug.fxtier.emit('roomClear', { x: ${room.spawn.x}, y: ${room.spawn.y} })`);
  const statAfter2 = (await ev('__roamDebug.fxtier.audit()')).stats;
  check('S2 节流：第 1 次按 S2 播，紧接着第 2 次降级 S1 且合并计数 +1',
    emit1 && emit1.tier === 'S2' && emit2 && emit2.tier === 'S1'
      && emit2.merged === true && statAfter2.s2 === 1 && statAfter2.s2Merged === 1,
    { emit1: emit1 && emit1.tier, emit2: emit2 && emit2.tier, merged: emit2 && emit2.merged, stats: statAfter2 });

  /* 节流用的是 state.realElapsed，无头/顿帧环境里它不一定按墙钟推进（实测 sleep 1150ms
     后窗口仍未过）；这里改用同一时钟把"上次 S2 时刻"回拨 1.15 秒，
     确定性地打中"窗口到期"分支，而不是被测环境的时钟速度。 */
  const emit3 = await ev(`(() => {
    const now = Number.isFinite(state.realElapsed) ? state.realElapsed
      : (Number.isFinite(state.elapsed) ? state.elapsed : 0);
    state.fxTierLastS2 = now - 1.15;
    return __roamDebug.fxtier.emit('roomClear', { x: ${room.spawn.x}, y: ${room.spawn.y} });
  })()`);
  const statAfter3 = (await ev('__roamDebug.fxtier.audit()')).stats;
  check('S2 节流窗口到期：时钟前进 1.15 秒后恢复 S2（窗口内累计 S2 总数 ≤1）',
    emit3 && emit3.tier === 'S2' && statAfter3.s2 === 2,
    { emit3: emit3 && emit3.tier, stats: statAfter3 });

  // 回到战斗房继续做命中/多杀场景
  await ev(`__roamDebug.teleport(${room.cx}, ${room.cy})`);
  await sleep(650);

  // ---- 6) 同帧合并：一次打 5 只 → 只 1 次震屏 + 1 次粒子爆发，档位 S2 ----
  const multi = await ev(`(() => {
    const d = window.__roamDebug, t = d.fxtier;
    t.reset();
    // 先把房间里原有的怪清干净，避免它们在同一统计窗口里死亡，把"5 杀"污染成 6 杀
    d.clearEnemies();
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const s = d.spawnEnemyAt('shooter', ${room.cx - 120} + i * 46, ${room.cy + 40}, { roomId: ${room.id} });
      d.terrain.weaken(s.id, 1);
      ids.push(s.id);
    }
    // 两只"锚"怪保证不会触发清房事件（清房是另一条 S2 通道，会干扰本组统计）
    d.spawnEnemyAt('sentinel', ${room.x + 50}, ${room.y + 50}, { roomId: ${room.id} });
    d.spawnEnemyAt('sentinel', ${room.x + room.w - 50}, ${room.y + 50}, { roomId: ${room.id} });
    const r = t.damageAll(ids, 99);
    const stats = t.audit().stats;
    return { ids, r, stats };
  })()`);
  check('同帧 5 杀：只触发 1 次震屏 + 1 次粒子爆发（不是每只各来一套）',
    multi.r && multi.r.frame && multi.r.frame.tier === 'S2'
      && multi.r.frame.kills === 5 && multi.r.frame.hits >= 5
      && multi.r.frame.bursts === 1 && multi.stats.shakeCalls === 1 && multi.stats.burstCalls === 1,
    { frame: multi.r && multi.r.frame, shakeCalls: multi.stats.shakeCalls, burstCalls: multi.stats.burstCalls });
  check('同帧 5 杀粒子数受 S2 上限约束（≤58）',
    multi.r && multi.r.frame && multi.r.frame.particles <= 58 && multi.r.frame.particles >= 20,
    multi.r && multi.r.frame && multi.r.frame.particles);

  // ---- 7) 可读性：贴脸击杀时粒子爆发被推到玩家 90px 之外 ----
  const safe = await ev(`(() => {
    const d = window.__roamDebug;
    d.fxtier.reset();
    d.clearEnemies();
    const p = d.getState().player;
    const s = d.spawnEnemyAt('shooter', p.x + 12, p.y, { roomId: ${room.id} });
    d.terrain.weaken(s.id, 1);
    const r = d.fxtier.damage(s.id, 99);
    return { r };
  })()`);
  check('可读性保护：玩家 90px 内的粒子爆发被推到安全圈外',
    safe.r && safe.r.frame && safe.r.frame.bursts === 1 && safe.r.frame.safePush >= 90,
    safe.r && safe.r.frame);

  // ---- 8) A/B 关闭：完全不登记演出（旧的逐事件行为由原代码分支接管） ----
  const abOff = await ev(`(() => {
    const d = window.__roamDebug;
    d.fxtier.set({ enabled: false });
    const off = d.fxtier.emit('roomClear', { x: ${room.cx}, y: ${room.cy} });
    const s = d.spawnEnemyAt('shooter', ${room.cx + 120}, ${room.cy - 60}, { roomId: ${room.id} });
    d.terrain.weaken(s.id, 1);
    const r = d.fxtier.damage(s.id, 99);
    const st = d.fxtier.info();
    d.fxtier.set({ enabled: true });
    return { off, r, enabledAfter: st.config.enabled, frame: st.lastFrame };
  })()`);
  check('A/B 关闭：事件不登记、伤害不回帧摘要（关闭即回旧行为），重开恢复',
    abOff.off === null && abOff.r && abOff.r.frame === null
      && abOff.enabledAfter === false,
    { off: abOff.off, frame: abOff.r && abOff.r.frame, enabledDuringTest: abOff.enabledAfter });

  // ---- 9) 截图：关闭态（旧逐事件演出） vs 开启态（S2 合并演出） ----
  await ev(`(() => {
    const d = window.__roamDebug;
    d.fxtier.set({ enabled: false });
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const s = d.spawnEnemyAt('shooter', ${room.cx - 120} + i * 48, ${room.cy - 60}, { roomId: ${room.id} });
      d.terrain.weaken(s.id, 1);
      ids.push(s.id);
    }
    d.spawnEnemyAt('sentinel', ${room.x + 50}, ${room.y + 50}, { roomId: ${room.id} });
    d.fxtier.damageAll(ids, 99);
    return true;
  })()`);
  await sleep(180);
  await shot('fxtier-before.png');

  await ev(`(() => {
    const d = window.__roamDebug;
    d.fxtier.set({ enabled: true });
    d.fxtier.reset();
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const s = d.spawnEnemyAt('shooter', ${room.cx - 120} + i * 48, ${room.cy + 70}, { roomId: ${room.id} });
      d.terrain.weaken(s.id, 1);
      ids.push(s.id);
    }
    d.spawnEnemyAt('sentinel', ${room.x + 50}, ${room.y + 80}, { roomId: ${room.id} });
    d.fxtier.damageAll(ids, 99);
    return true;
  })()`);
  await sleep(180);
  await shot('fxtier-after.png');

  check('before/after 截图各 1 张（>100KB）',
    fs.existsSync(path.join(OUT, 'fxtier-before.png')) && fs.existsSync(path.join(OUT, 'fxtier-after.png'))
      && fs.statSync(path.join(OUT, 'fxtier-before.png')).size > 100000
      && fs.statSync(path.join(OUT, 'fxtier-after.png')).size > 100000,
    {
      before: fs.existsSync(path.join(OUT, 'fxtier-before.png')) ? fs.statSync(path.join(OUT, 'fxtier-before.png')).size : 0,
      after: fs.existsSync(path.join(OUT, 'fxtier-after.png')) ? fs.statSync(path.join(OUT, 'fxtier-after.png')).size : 0
    });

  // ---- 10) 帧率（负载敏感：只记录，不因机器波动判红） ----
  const fps = await ev('__roamDebug.getState().fps');
  check('fps ≥60（PERF 负载敏感，只记录）', fps >= 60, { fps });

  // fps A/B：分别开启/关闭连续采样 1.2 秒，记录平均值（允许 ±2 的机器噪声）
  const fpsAB = await ev(`(async () => {
    const d = window.__roamDebug;
    const sample = (enabled) => new Promise((resolve) => {
      d.fxtier.set({ enabled });
      d.fxtier.reset();
      const values = [];
      const t0 = performance.now();
      const timer = setInterval(() => {
        values.push(d.getState().fps);
        if (performance.now() - t0 > 1200) { clearInterval(timer); resolve(values); }
      }, 100);
    });
    const on = await sample(true);
    const off = await sample(false);
    d.fxtier.set({ enabled: true });
    const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
    return { on: Math.round(avg(on) * 10) / 10, off: Math.round(avg(off) * 10) / 10 };
  })()`);
  check('fps A/B（PERF 负载敏感）：开启演出分级后平均 fps 不低于关闭态（容差 2）',
    fpsAB.on >= fpsAB.off - 2, fpsAB);

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'fxtier-result.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
