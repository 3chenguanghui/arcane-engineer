// G 批专项验收（事件版）：首局 5 个事件提示（每条 ≤12 字 / 只出现一次 / 第二局 0 次 / 老档跳过 / A/B）
// 语义升级：触发点跟玩家真实遭遇走，不跟楼层走；showFloor 只生成楼层，不再负责弹提示。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const { summarize } = require('./test_known_red');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9541;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'onboard');

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

  // ---- 0) 模拟新号：最佳楼层 0、融合已解锁、结晶 3、清空教学独立存档 ----
  await ev(`(() => {
    const d = window.__roamDebug;
    state.meta.bestFloor = 0;
    state.meta.crystals = 3;
    state.meta.unlocks.fusion = true;
    state.meta.unlocks.device = true;
    d.onboard.reset(true);
    return true;
  })()`);

  // ---- 1) 配置与五事件表 ----
  const cfg = await ev('__roamDebug.onboard.info()');
  check('配置：enabled / 5 层 / 老档阈值 5 / 数量 ×0.8 / 单条 ≤12 字',
    cfg.config.enabled === true && cfg.config.maxFloors === 5
      && cfg.config.skipBestFloor === 5 && cfg.config.enemyCountMul === 0.8
      && cfg.config.hintMaxChars === 12,
    cfg.config);
  check('5 个事件各一条：进入房间 / 第一次选牌 / 第一次精英 / 低血 / 第一次结晶',
    cfg.steps.length === 5
      && cfg.steps[0].key === 'firstRoom' && cfg.steps[1].key === 'firstChoice'
      && cfg.steps[2].key === 'firstElite' && cfg.steps[3].key === 'lowHp'
      && cfg.steps[4].key === 'firstCrystal',
    cfg.steps.map((s) => s.key + ':' + s.chars));
  check('事件序号 n=1..5（不再有 floor 字段）',
    cfg.steps.map((s) => s.n).join(',') === '1,2,3,4,5'
      && cfg.steps.every((s) => s.floor === undefined),
    cfg.steps.map((s) => s.n));
  check('每条提示 ≤12 字（逐条实测）', cfg.steps.every((s) => s.chars <= 12),
    cfg.steps.map((s) => s.chars));

  // ---- 2) 前五层固定难度 + 数量 −20%；噩梦档也不改 −---
  // 基数取 6：简单档 0.75 → 5 只、噩梦档 1.05 → 6 只，能真正证明"难度仍影响常规数量"
  const counts = await ev(`(() => {
    const d = window.__roamDebug;
    state.difficulty = 'easy';
    const easy = d.onboard.difficulty(1, 6);
    state.difficulty = 'nightmare';
    const nightmare = d.onboard.difficulty(1, 6);
    state.difficulty = 'normal';
    return { easy, nightmare };
  })()`);
  // 设计值 3：ONBOARD_CONFIG.floor1CountCap=3，注释写明"原 2 只"，因为同帧三杀要求
  // 一房至少 3 只；改前断言写 2 是旧版残留，长期红着等于这条测试不存在。
  check('第 1 层教学设计值 3 只（两档都不受影响），但常规数量按难度变化（5 / 6）',
    counts.easy.onboard === 3 && counts.nightmare.onboard === 3
      && counts.easy.current === 5 && counts.nightmare.current === 6,
    counts);

  // ---- 3) firstRoom：进入非出生房触发；1.2s 延迟；贴右缘不压 HUD ----
  const f1 = await ev('__roamDebug.onboard.showFloor(1)');
  await sleep(320);
  check('showFloor 只生成楼层，不再按楼层弹提示', f1.hintVisible === false, { hint: f1.hint });

  const r1 = await ev(`(() => {
    onboardOnRoomEnter({ id: 424242, type: 'normal' });
    const info = __roamDebug.onboard.info();
    return { pending: info.pending, hintVisible: info.hintVisible };
  })()`);
  check('firstRoom 由真实进房回调接受（delay 1.2s 先入 pending）',
    r1.pending.length === 1 && r1.pending[0].key === 'firstRoom' && r1.hintVisible === false,
    r1);
  await sleep(1300);
  const f1hint = await ev('__roamDebug.onboard.info()');
  check('firstRoom 上屏且 ≤12 字', f1hint.hintVisible === true
    && f1hint.hint.key === 'firstRoom'
    && Array.from(f1hint.hint.text || '').length <= 12, f1hint.hint);
  await shot('onboard-f1.png');

  // 可读性：提示贴右缘、避开中央准星与左侧血条/奥能条
  const geo = await ev(`(() => {
    const hint = document.getElementById('onboardHint').getBoundingClientRect();
    const hp = document.getElementById('hpBar').getBoundingClientRect();
    const aether = document.getElementById('aetherBar').getBoundingClientRect();
    const overlap = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    return {
      rightGap: Math.round(innerWidth - hint.right),
      centerClear: !(hint.left < cx + 110 && hint.right > cx - 110 && hint.top < cy + 90 && hint.bottom > cy - 90),
      hudClear: !overlap(hint, hp) && !overlap(hint, aether),
      width: Math.round(hint.width), height: Math.round(hint.height)
    };
  })()`);
  check('提示贴右缘、不压准星、不遮血条与奥能条',
    geo.rightGap >= 12 && geo.rightGap <= 24 && geo.centerClear === true && geo.hudClear === true,
    geo);

  // 真实移动：按住右 0.55s（走 ≥48px 才算移动证据）
  await ev(`(() => { state.keys.right = true; return true; })()`);
  await sleep(560);
  await ev(`(() => { state.keys.right = false; return true; })()`);
  const moveInfo = await ev('__roamDebug.onboard.info()');
  check('移动证据：真实按住方向键后 moved=true', moveInfo.moved === true, { moved: moveInfo.moved });

  // 同一条提示只出现一次（独立存档键）
  const repeat = await ev(`(() => {
    const a = __roamDebug.onboard.event('firstRoom');
    const b = __roamDebug.onboard.showFloor(1);
    return { triggerAgain: a.ok, hintAfterReenter: b.hintVisible };
  })()`);
  check('同一事件不重复出现（event 第二次 false，重进楼层也不再弹）',
    repeat.triggerAgain === false && repeat.hintAfterReenter === false,
    repeat);

  // ---- 4) 第 2 层：保底可融件 + 金框角标 + firstChoice 弹窗内提示 ----
  await ev('__roamDebug.onboard.reset(true)');
  const f2 = await ev('__roamDebug.onboard.showFloor(2)');
  await sleep(320);
  check('第 2 层不按楼层弹提示（firstChoice 只跟三选一走）', f2.hintVisible === false, { hint: f2.hint });
  const kit = await ev(`(() => {
    const d = window.__roamDebug;
    const magic = state.ownedMagic.slice();
    const tech = state.ownedTech.slice();
    const gold = document.querySelectorAll('.mini-card.is-fusable').length;
    const badge = document.querySelectorAll('.mini-card .m-fuse-badge').length;
    const fused = d.onboard.act('fuse');
    return { magic, tech, gold, badge, fusedOk: fused.ok };
  })()`);
  check('第 2 层保底一套可融件：火球 + 聚能都在手上',
    kit.magic.indexOf('fireball') >= 0 && kit.tech.indexOf('concentrator') >= 0,
    { magic: kit.magic, tech: kit.tech });
  check('卡面金框 +「可融合」角标（两张卡都在）', kit.gold >= 2 && kit.badge >= 2,
    { gold: kit.gold, badge: kit.badge });
  check('真实按 F 融合成功（与教学提示解耦）', kit.fusedOk === true, { fusedOk: kit.fusedOk });

  // 真实 openReward('skill') → firstChoice 必须渲染在弹窗内部（浮动条被 z-index 60 盖住）
  await ev(`(() => { state.mode = 'playing'; state.status = 'playing'; openReward('floor', 'skill'); return true; })()`);
  await sleep(150);
  const choice = await ev(`(() => ({
    line: __roamDebug.onboard.modalLine(),
    ev: __roamDebug.onboard.info().ev
  }))()`);
  check('firstChoice 渲染进弹窗内部（弹窗内提示行可读到）',
    /选牌优先凑融合/.test(choice.line || '') && choice.ev.firstChoice === true,
    choice);
  await shot('onboard-f2.png');

  // ---- 5) firstElite：精英房进房回调；K/Shift 仍真实可用 ----
  await ev('__roamDebug.onboard.reset(true)');
  const f3 = await ev('__roamDebug.onboard.showFloor(3)');
  await sleep(320);
  check('第 3 层不按楼层弹提示', f3.hintVisible === false, { hint: f3.hint });
  const elite = await ev(`(() => {
    onboardOnRoomEnter({ id: 515151, type: 'elite' });
    const info = __roamDebug.onboard.info();
    return { ev: info.ev, hint: info.hint };
  })()`);
  check('firstElite 由精英房进房触发',
    elite.ev.firstElite === true && !!(elite.hint && elite.hint.key === 'firstElite'), elite);
  await shot('onboard-f3.png');
  const dash = await ev(`(() => {
    const d = window.__roamDebug;
    const a = d.onboard.act('device');
    const b = d.onboard.act('dash');
    return {
      deviceOk: a.ok, dashOk: b.ok,
      alive: state.status === 'playing' && state.player.hp > 0
    };
  })()`);
  check('K 装置 + Shift 冲刺真实可用且存活（与提示解耦）',
    dash.deviceOk === true && dash.dashOk === true && dash.alive === true, dash);

  // ---- 6) lowHp：真实 damagePlayer（复用每局一次的 lowHpFired） ----
  await ev('__roamDebug.onboard.reset(true)');
  const f4 = await ev('__roamDebug.onboard.showFloor(4)');
  await sleep(320);
  check('第 4 层不按楼层弹提示（低血可在任意层触发）', f4.hintVisible === false, { hint: f4.hint });
  const low = await ev(`(() => {
    state.player.hpMax = Math.max(state.player.hpMax, 200);
    state.player.hp = state.player.hpMax * 0.25;
    state.fx.lowHpFired = false;
    state.player.invuln = 0;
    __roamDebug.p1.damagePlayer(1, 'contact', '验收小怪');
    const info = __roamDebug.onboard.info();
    return {
      ev: info.ev.lowHp, hint: info.hint,
      fired: state.fx.lowHpFired, hpPct: Math.round(state.player.hp / state.player.hpMax * 100)
    };
  })()`);
  check('lowHp 由真实伤害路径触发（lowHpFired 每局一次）',
    low.ev === true && low.fired === true && !!(low.hint && low.hint.key === 'lowHp'), low);
  await shot('onboard-f4.png');

  // ---- 7) firstCrystal：真实入账 + 死亡结算三张预览卡 + 完成一次天赋升级 ----
  await ev('__roamDebug.onboard.reset(true)');
  const f5 = await ev('__roamDebug.onboard.showFloor(5)');
  await sleep(320);
  check('第 5 层不按楼层弹提示（firstCrystal 只跟真实入账走）', f5.hintVisible === false, { hint: f5.hint });
  const crystal = await ev(`(() => {
    const before = __roamDebug.onboard.info().ev.firstCrystal;
    grantRunCrystals(3, 'test');
    const info = __roamDebug.onboard.info();
    return { before: before, after: info.ev.firstCrystal, hint: info.hint };
  })()`);
  check('firstCrystal 由真实结晶入账触发',
    crystal.after === true && !!(crystal.hint && crystal.hint.key === 'firstCrystal'), crystal);
  await shot('onboard-f5.png');
  const preview = await ev(`(() => {
    const d = window.__roamDebug;
    state.meta.crystals = Math.max(3, state.meta.crystals);
    const dead = d.onboard.lose();
    const hpBefore = state.player.hpMax;
    const bought = d.onboard.talent('vitality');
    return {
      dead, bought, hpBefore,
      hpAfter: state.player.hpMax,
      talents: state.meta.talents
    };
  })()`);
  check('第 5 层死亡结算页出现三张结晶预览卡', preview.dead.preview === true && preview.dead.previewRows === 3,
    preview.dead);
  // 第 11 项：天赋 v2 把 v1 的 "vitality" 映射为 "hp"（+5% 基础生命/级）
  check('完成一次天赋升级（体魄 Lv1）',
    preview.bought === true && preview.talents.hp === 1,
    { talents: preview.talents });
  check('升级后当前局立刻有可见差异（最大生命 +5%）',
    preview.hpAfter > preview.hpBefore &&
    Math.abs(preview.hpAfter - Math.round(preview.hpBefore * 1.05)) <= 1,
    { hpBefore: preview.hpBefore, hpAfter: preview.hpAfter });

  // ---- 8) 下一局开局仍有可见差异（重开后 hpMax = 120） ----
  const nextRun = await ev(`(() => {
    restartRun();
    return { hpMax: state.player.hpMax, base: GAME_CONFIG.baseHp, bestFloor: state.meta.bestFloor };
  })()`);
  await sleep(300);
  check('下一局开局可见差异：最大生命 105（基础 100 × 1.05）',
    nextRun.hpMax === Math.round(nextRun.base * 1.05), nextRun);

  // ---- 9) 老存档（bestFloor ≥5）跳过全部教学 ----
  const oldSave = await ev(`(() => {
    const d = window.__roamDebug;
    state.meta.bestFloor = 5;
    d.onboard.reset(false);
    const info = d.onboard.info();
    const f = d.onboard.showFloor(1);
    const e = d.onboard.event('firstRoom');
    return {
      skipAll: info.skipAll, active: info.active,
      hintVisible: f.hintVisible, hint: f.hint, eventOk: e.ok
    };
  })()`);
  check('老档 bestFloor ≥5 整轮跳过：skipAll=true、不弹提示、event 恒 false',
    oldSave.skipAll === true && oldSave.active === false
      && oldSave.hintVisible === false && oldSave.eventOk === false,
    oldSave);
  await ev(`(() => { state.meta.bestFloor = 0; return true; })()`);

  // ---- 10) A/B：enabled=false 回到旧行为（不弹提示、不降难度、不发保底件） ----
  const ab = await ev(`(() => {
    const d = window.__roamDebug;
    d.onboard.reset(true);
    d.onboard.set({ enabled: false });
    const info = d.onboard.info();
    const trigger = d.onboard.event('firstRoom');
    const f = d.onboard.showFloor(1);
    const kitOff = state.ownedTech.indexOf('concentrator');
    return {
      active: info.active, triggerOk: trigger.ok,
      hintVisible: f.hintVisible,
      kitAddedOnFloor1: kitOff,
      enabled: info.config.enabled
    };
  })()`);
  check('A/B 关闭：active=false、event=false、不弹提示、不发保底件',
    ab.active === false && ab.triggerOk === false && ab.hintVisible === false
      && ab.kitAddedOnFloor1 === -1 && ab.enabled === false,
    ab);
  await ev('__roamDebug.onboard.set({ enabled: true })');

  // ---- 11) 截图 5 张（每层 1 张，均 >100KB） ----
  const shots = ['onboard-f1.png', 'onboard-f2.png', 'onboard-f3.png', 'onboard-f4.png', 'onboard-f5.png'];
  const sizes = shots.map((name) => (fs.existsSync(path.join(OUT, name)) ? fs.statSync(path.join(OUT, name)).size : 0));
  check('五层各 1 张截图（共 5 张，每张 >100KB）',
    sizes.every((size) => size > 100000), { sizes });

  // ---- 12) 帧率（负载敏感：只记录） ----
  const fps = await ev('__roamDebug.getState().fps');
  check('fps ≥60（PERF 负载敏感，只记录）', fps >= 60, { fps });

  // 教学开/关 A/B：教学期敌更少，fps 不应低于关闭态（容差 2，负载敏感）
  const fpsAB = await ev(`(async () => {
    const d = window.__roamDebug;
    const sample = (enabled) => new Promise((resolve) => {
      d.onboard.set({ enabled: enabled });
      const values = [];
      const t0 = performance.now();
      const timer = setInterval(() => {
        values.push(d.getState().fps);
        if (performance.now() - t0 > 1200) { clearInterval(timer); resolve(values); }
      }, 100);
    });
    const on = await sample(true);
    const off = await sample(false);
    d.onboard.set({ enabled: true });
    const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
    return { on: Math.round(avg(on) * 10) / 10, off: Math.round(avg(off) * 10) / 10 };
  })()`);
  check('教学期 fps 不降（PERF 负载敏感，容差 2）', fpsAB.on >= fpsAB.off - 2, fpsAB);

  const errs = await ev('__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  // 已知红（若有）单独打印、不计入通过率；PERF 负载敏感项只记录，不参与判红
  const s = summarize(results.filter((r) => r.name.indexOf('PERF') < 0), '教学功能');
  fs.writeFileSync(path.join(OUT, 'onboard-result.json'), JSON.stringify({ pass: s.pass, total: s.total, known: s.known, results }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  process.exitCode = s.exitCode;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
