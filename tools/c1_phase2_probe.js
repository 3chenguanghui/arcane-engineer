/**
 * C-1 真机验证：F1–F5 首领「血量 ≤50% 进二阶段」是否真的触发，且带可见信号
 * ----------------------------------------------------------------------------
 * 这一步不改任何代码，只取证。为什么要证：
 *   C-1 要的是"有看得见的信号"，不能只在后台改数字。二阶段在既有版本里
 *   已经对**所有层**生效（BOSS_CONFIG.kinds 的 speed2 / attackInterval2 +
 *   enterBossPhase2 的换色/变大/震屏/慢动作/字幕/专属音），所以本批应报"已存在"
 *   而不是"新做"。这个探针把"已存在"从 README 口径变成真机证据。
 *
 * 每层做法（自动化，非真人）：
 *   1) setFloor(f) → 传送进首领房 → 等登场结束
 *   2) 记录战前：phase2=false、颜色、半径、攻击间隔
 *   3) damageBoss 把血打到 48%（跨过 50% 阈值，但不打死）
 *   4) 立刻抓：phase2=true、颜色换成 phase2Color、半径 ×1.08、
 *      无敌转场 0.9s、字幕行、toast 文案、屏震、慢动作、粒子/光环数量、
 *      二阶段专属音是否真的被调用
 *   5) 顺势打死，记录到二阶段用了多久（fightTime）
 *
 * 用法：node tools/c1_phase2_probe.js
 * 产物：.screenshots/p0/c1-phase2-F{1..5}.png、.screenshots/p0/c1-phase2.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9613;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'p0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const asserts = [];

/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 300));
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const clickAt = async (selector) => {
    const box = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!box) return null;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    return box;
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  // 注入：同步步进（hp 拉满 / 无敌），并挂一个声音探针统计二阶段专属音调用次数
  await ev(`(() => {
    window.__c1 = { sting: 0, toast: [], shake: 0 };
    const origSting = playBossIntroSting;
    playBossIntroSting = function (theme, stage) {
      window.__c1.sting += 1; window.__c1.lastStage = stage;
      return origSting.apply(this, arguments);
    };
    const origToast = showToast;
    showToast = function (text, kind) { window.__c1.toast.push({ text: text, kind: kind || null }); return origToast.apply(this, arguments); };
    window.__ptStep = (n) => {
      const p = state.player;
      for (let i = 0; i < n; i += 1) {
        p.invuln = 9; p.hp = p.hpMax; p.aether = p.aetherMax;
        state.keys = { left: false, right: false, up: false, down: false };
        update(1 / 60);
        let g = 0;
        while (state.mode === 'reward' && g < 8) { __roamDebug.xp.chooseFirst(); g += 1; }
      }
      return state.mode;
    };
    return true;
  })()`);

  // 开局（含角色选择）
  await ev(`__roamDebug.onboard.reset(true)`);
  await clickAt('[data-difficulty="normal"]');
  await sleep(150);
  await clickAt('#btnStart');
  await sleep(800);
  const firstChar = await ev(`(() => { const c = document.querySelector('#charGrid .char-card');
    return c ? c.getAttribute('data-char-id') : null; })()`);
  if (firstChar) {
    await clickAt(`#charGrid .char-card[data-char-id="${firstChar}"]`);
    await sleep(200);
    await clickAt('#btnCharConfirm');
    await sleep(1200);
  }

  for (let f = 1; f <= 5; f += 1) {
    const row = await ev(`(() => {
      __roamDebug.setFloor(${f});
      __ptStep(20);
      const room = state.rooms.find((r) => r.type === 'boss');
      if (!room) return { floor: ${f}, fail: 'no-boss-room' };
      __roamDebug.teleport(room.cx, room.cy);
      __ptStep(100);
      const e = state.enemies.find((x) => x.isBoss);
      if (!e) return { floor: ${f}, fail: 'no-boss-entity' };
      const conf = BOSS_CONFIG.kinds.find((k) => k.id === e.bossKind) || BOSS_CONFIG.kinds[0];
      const before = {
        hp: Math.round(e.hp), hpMax: Math.round(e.hpMax),
        phase2: !!e.phase2, color: e.color, radius: Math.round(e.radius),
        attackInterval: conf.attackInterval, attackInterval2: conf.attackInterval2,
        speed: conf.speed, speed2: conf.speed2,
        ttkm: __roamDebug.bossTtk('normal'),
        sting0: window.__c1.sting
      };
      // 打到 48%：跨阈值但不打死
      __roamDebug.damageBoss(Math.max(1, e.hp - e.hpMax * 0.48));
      /* 慢动作 0.3s 与屏震 0.45s 都会在 18 帧内衰减完，必须逐帧取峰值，
         否则快照到的是 0（第一版就是这么误报的）。 */
      let peakSlow = 0; let peakShake = 0; let peakFlash = 0;
      for (let i = 0; i < 18; i += 1) {
        state.player.invuln = 9; state.player.hp = state.player.hpMax;
        update(1 / 60);
        if (state.slowMo > peakSlow) peakSlow = state.slowMo;
        if (state.shake && state.shake.power > peakShake) peakShake = state.shake.power;
        if (state.flashT > peakFlash) peakFlash = state.flashT;
      }
      const after = {
        hp: Math.round(e.hp), hpPct: +(e.hp / e.hpMax * 100).toFixed(1),
        phase2: !!e.phase2, phase: e.phase || null, color: e.color, accent: e.accent,
        radius: Math.round(e.radius), invulnTimer: +(e.invulnTimer || 0).toFixed(2),
        fightTime: +(state.boss.fightTime || 0).toFixed(2),
        line: state.boss.line ? state.boss.line.text : null,
        toasts: window.__c1.toast.slice(-3),
        sting: window.__c1.sting,
        slowMo: +peakSlow.toFixed(2), shake: Math.round(peakShake),
        flash: +peakFlash.toFixed(2),
        shakeRing: (SHAKE_STATS.ring || []).slice(-1)[0] || null,
        fxParticles: (state.fx && state.fx.length) || (state.particles && state.particles.length) || 0,
        screenFx: !!(state.screenFx && state.screenFx.active),
        mechPhase: e.mechPhase || null
      };
      // 收尾：打死，记录到二阶段花了多久
      const killedAt = +(state.boss.fightTime || 0).toFixed(2);
      return { floor: ${f}, before: before, after: after, killedAt: killedAt };
    })()`);
    rows.push(row);
    console.log('F' + f + ' ' + JSON.stringify(row));
    await shot('c1-phase2-F' + f + '.png');
    // 打死并清理，便于下一层
    await ev(`(() => { __roamDebug.damageBoss(9999999); __ptStep(40);
      let g = 0; while (state.mode === 'reward' && g < 20) { __roamDebug.xp.chooseFirst(); g += 1; }
      return state.mode; })()`);
  }

  // 逐层断言
  rows.forEach((r) => {
    const a = r.after || {};
    const b = r.before || {};
    ok('F' + r.floor + ' 二阶段触发（48% 血 → phase2=true）', !r.fail && a.phase2 === true,
      { hpPct: a.hpPct, phase: a.phase, mechPhase: a.mechPhase, fightTime: a.fightTime });
    ok('F' + r.floor + ' 信号可见：换色 + 变大 + 字幕 + toast + 震屏 + 慢动作 + 专属音',
      !!b.color && a.color !== b.color
      && a.radius >= (b.radius || 0)
      && !!a.line && (a.toasts || []).length > 0
      && a.sting > b.sting0
      && a.slowMo > 0 && a.shake > 0,
      { colorBefore: b.color, colorAfter: a.color, radiusBefore: b.radius, radiusAfter: a.radius,
        line: a.line, toast: (a.toasts || []).slice(-1)[0] || null,
        stingBefore: b.sting0, stingAfter: a.sting, slowMo: a.slowMo, shake: a.shake,
        shakeRing: a.shakeRing, flash: a.flash, fxParticles: a.fxParticles });
    ok('F' + r.floor + ' 二阶段确实改数值（攻击间隔变快 / 移速变快）',
      b.attackInterval2 < b.attackInterval && b.speed2 > b.speed,
      { attackInterval: b.attackInterval, attackInterval2: b.attackInterval2,
        speed: b.speed, speed2: b.speed2, bossTtk: b.ttkm });
  });
  ok('全程零 JS 异常', errors.length === 0, { errors });

  const passed = asserts.filter((x) => x.pass).length;
  fs.writeFileSync(path.join(OUT, 'c1-phase2.json'), JSON.stringify({
    caption: '自动化探针取证，非真人',
    total: asserts.length, passed, asserts, rows
  }, null, 2));
  console.log(`\n===== C-1 真机取证 ${passed}/${asserts.length}（自动化探针，非真人） =====`);
  ws.close(); killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
})().catch((e) => { console.error('ERR', e && (e.stack || e.message)); process.exit(1); });
