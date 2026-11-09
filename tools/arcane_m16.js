// M1-6 专项验收：辅助瞄准三档（关闭 / 弱辅助 / 强辅助）各 30 发命中率与偏转角度
// 用法：node arcane_m16.js <html绝对路径> <截图输出目录>
// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9465;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm16');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

/**
 * 记录一条断言并即时打印
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * 从原始样本里按档位汇总：命中率 / 输入偏转 / 锁定偏转 / 实际剩余偏转
 * @param {Array<Object>} shots 全部样本
 * @param {string} mode 档位
 * @returns {Object} 单档统计
 */
function summarize(shots, mode) {
  const list = shots.filter((s) => s.mode === mode);
  const hits = list.filter((s) => s.hit).length;
  const locked = list.filter((s) => s.locked);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const byOffset = {};
  list.forEach((s) => {
    const key = String(s.offsetDeg);
    if (!byOffset[key]) byOffset[key] = { shots: 0, hits: 0, minDistAvg: 0 };
    byOffset[key].shots += 1;
    if (s.hit) byOffset[key].hits += 1;
    byOffset[key].minDistAvg += s.minDist;
  });
  Object.keys(byOffset).forEach((key) => {
    byOffset[key].minDistAvg = Number((byOffset[key].minDistAvg / byOffset[key].shots).toFixed(1));
    byOffset[key].rate = Math.round(byOffset[key].hits / byOffset[key].shots * 100);
  });
  return {
    mode,
    shots: list.length,
    hits,
    hitRate: list.length ? Math.round(hits / list.length * 1000) / 10 : 0,
    lockedShots: locked.length,
    avgInputDeg: Number(avg(list.map((s) => s.offsetDeg)).toFixed(2)),
    avgLockDeflectDeg: Number(avg(locked.map((s) => s.deflectDeg)).toFixed(2)),
    avgResidualDeg: Number(avg(list.map((s) => s.residualDeg)).toFixed(2)),
    /* 只看"确实锁定了目标"的样本：这才是偏转修正的真实效果 */
    avgLockResidualDeg: Number(avg(locked.map((s) => s.residualDeg)).toFixed(2)),
    avgUnlockedResidualDeg: Number(avg(list.filter((s) => !s.locked).map((s) => s.residualDeg)).toFixed(2)),
    avgMinDist: Number(avg(list.filter((s) => s.minDist >= 0).map((s) => s.minDist)).toFixed(1)),
    hitRadius: list.length ? list[0].hitRadius : 0,
    hitBonus: list.length ? list[0].hitBonus : 0,
    splashOnly: list.filter((s) => !s.hit && s.hpDelta > 0).length,
    byOffset
  };
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  // 以无头模式启动 Edge，并打开 CDP 调试端口（与其它专项脚本同一套做法）
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起来，继续等 */ }
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

  /**
   * 在页面里执行一段表达式并取回值
   * @param {string} expression JS 表达式（可以是 Promise）
   * @returns {Promise<*>} 序列化后的结果
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  /** 整屏截图到 OUT 目录 */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  /** 以玩家为中心的局部放大截图（看清准星 / 锁定指示） */
  const shotClip = async (name, w = 460, h = 320, scale = 2) => {
    const pos = await ev(`(() => { const s = window.__roamDebug.getState(); return { x: s.player.x - s.cam.x, y: s.player.y - s.cam.y }; })()`);
    const x = Math.max(0, Math.round(pos.x - w / 2));
    const y = Math.max(0, Math.round(pos.y - h / 2));
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale } });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  /** 点击页面里的元素（CSS 选择器） */
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };
  const mouseMove = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(700);

  // ==================== 1) 页内准备：清场 + 选开阔方向 + 放置"打不死"的靶子 ====================
  const setup = await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.restart();
    await sleep(450);
    d.centerPlayer();
    await sleep(200);
    /* 直接清空敌人数组：不能用 killAllEnemies（会串清层奖励把世界停住） */
    state.enemies.length = 0;
    state.bullets.length = 0;
    d.setHp(state.player.hpMax);
    d.setAether(state.player.aetherMax);
    d.setKeys({});
    await sleep(100);

    const p = state.player;
    /* 找"最开阔"的方向：8 个候选方向按 20px 步长探路，取可走距离最长的 */
    let best = { angle: 0, free: 0 };
    for (let i = 0; i < 8; i += 1) {
      const a = i * Math.PI / 4;
      let free = 0;
      for (let r = 40; r <= 640; r += 20) {
        if (!d.walkableAt(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r)) break;
        free = r;
      }
      if (free > best.free) best = { angle: a, free };
    }
    /* 靶子距离：房间只有 380×300 左右，固定取 120px（留 30px 余量给墙），
       距离固定后三档的"判定角"才可比；偏移角由测试端按这个距离反算 */
    const dist = Math.max(110, Math.min(120, best.free - 30));
    const spawn = d.spawnEnemyAt('crawler', p.x + Math.cos(best.angle) * dist, p.y + Math.sin(best.angle) * dist, {});
    const dummy = state.enemies[state.enemies.length - 1];
    /* 把靶子做成"打不死、站桩"：血量极大、速度 0，保证 30 发不会换目标 */
    dummy.hp = 5000000;
    dummy.hpMax = 5000000;
    dummy.speed = 0;
    dummy.vx = 0;
    dummy.vy = 0;
    window.__m16 = {
      dummyId: dummy.id,
      dir: best.angle,
      free: best.free,
      dist: dist,
      shots: []
    };
    return {
      dummyId: dummy.id,
      radius: Number(dummy.radius.toFixed(1)),
      hp: dummy.hp,
      dirDeg: Number((best.angle * 180 / Math.PI).toFixed(1)),
      free: best.free,
      dist: dist,
      clearance: best.free - dist,
      mode: d.getState().mode
    };
  })()`);
  console.log('场景：', JSON.stringify(setup));

  // ==================== 2) 页内主流程：单发 ====================
  // 每次发射都走真实路径：setMouseAim 只改"原始鼠标角度"，辅助瞄准由游戏自己算
  await ev(`window.__m16Fire = async function (mode, offsetDeg) {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const M = window.__m16;
    const norm = (a) => { let v = (a + Math.PI) % (Math.PI * 2); if (v < 0) v += Math.PI * 2; return v - Math.PI; };
    const dummy = state.enemies.find((e) => e.id === M.dummyId);
    if (!dummy) throw new Error('靶子丢失');
    const p = state.player;

    // 1) 每发都把靶子复位到基准点：击退会让它漂移，复位才能保证 30 发条件一致
    dummy.x = p.x + Math.cos(M.dir) * M.dist;
    dummy.y = p.y + Math.sin(M.dir) * M.dist;
    dummy.vx = 0;
    dummy.vy = 0;
    dummy.hp = 5000000;
    dummy.hpMax = 5000000;
    const targetAngle = Math.atan2(dummy.y - p.y, dummy.x - p.x);

    // 2) 制造相同的输入偏差：只改原始瞄准角，不碰 aim.angle（辅助修正由游戏算）
    d.setMouseAim(targetAngle + offsetDeg * Math.PI / 180);
    await sleep(180); // 等限速转向收敛（强辅助 14rad/s，25° 约 0.03s，留足余量）

    const aim = d.aimState();
    const hpBefore = dummy.hp;
    d.resetCooldowns();
    d.setAether(state.player.aetherMax);
    const castOk = d.cast();

    // 3) 逐帧记录"弹道中心到靶心"的最近距离：这是命中判定的几何证据
    let minDist = Infinity;
    let frames = 0;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        frames += 1;
        for (let i = 0; i < state.projectiles.length; i += 1) {
          const pr = state.projectiles[i];
          if (pr.beam) continue;
          const dd = Math.hypot(pr.x - dummy.x, pr.y - dummy.y);
          if (dd < minDist) minDist = dd;
        }
        if ((state.projectiles.length === 0 && frames > 1) || performance.now() - t0 > 800) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await sleep(20); // 伤害是同步结算的，这里只留一帧让飘字/特效稳定

    const hpDelta = Math.round(hpBefore - dummy.hp);
    const hitRadius = 8 * (1 + (aim.hitBonus || 0)) + dummy.radius;
    /* 命中判定：既要有真实伤害，弹道最近点也要进入判定圈（+8px 采样余量）。
       两个条件同时成立，才能排除"打偏后撞墙爆炸的溅射"被算成命中。 */
    const hit = hpDelta > 0 && Number.isFinite(minDist) && minDist <= hitRadius + 8;
    return {
      mode: mode,
      offsetDeg: offsetDeg,
      dist: Math.round(M.dist),
      targetAngle: Number((targetAngle * 180 / Math.PI).toFixed(1)),
      locked: !!aim.locked,
      deflectDeg: aim.deflectDeg,
      residualDeg: Number((Math.abs(norm(aim.angle - targetAngle)) * 180 / Math.PI).toFixed(2)),
      hitBonus: aim.hitBonus,
      hitRadius: Number(hitRadius.toFixed(1)),
      minDist: Number.isFinite(minDist) ? Number(minDist.toFixed(1)) : -1,
      hpDelta: hpDelta,
      hit: hit,
      castOk: castOk === true,
      frames: frames
    };
  }`);

  // ==================== 3) 三档各 30 发 ====================
  // 偏移角按"该距离下的真实判定边界"反算，每个档位都刻意避开边界（留 ≥10% 余量）：
  //   B_off  = 关闭档的命中边界角；B_weak = 弱辅助的命中边界角（含 bias 0.6 与命中半径 +20%）
  //   6 个角 × 5 发 = 30 发；期望：关闭档只吃 0/0.8B_off，弱辅助能吃到 0.9B_weak，强辅助全中
  const DEG = Math.PI / 180;
  const clamp01 = (v) => Math.min(0.99, Math.max(-0.99, v));
  const B_off = Math.asin(clamp01(21 / setup.dist)) / DEG;
  const B_weak = Math.asin(clamp01(22.6 / setup.dist)) / DEG / 0.4;
  const OFFSETS = [
    0,                                  // 完全对准：理论上三档都该中
    Math.round(0.8 * B_off),            // 关闭档仍能命中（刻意留 20% 余量）
    Math.round(1.6 * B_off),            // 关闭档应落空
    Math.min(24, Math.round(0.9 * B_weak)), // 弱辅助仍能命中（扇形内、且不超过 24° 避免贴边）
    Math.round(1.5 * B_off),            // 关闭档应落空、弱辅助应命中
    Math.max(28, Math.round(1.3 * B_weak))  // 弱辅助扇形外 → 退化为手动 → 应落空
  ];
  const REPEATS = 5;
  console.log(`距离 ${setup.dist}px 判定边界：关闭 ≈ ${B_off.toFixed(1)}°，弱辅助 ≈ ${B_weak.toFixed(1)}°；采样偏角 ${OFFSETS.join(' / ')}°`);
  const trials = {};
  for (const mode of ['off', 'weak', 'strong']) {
    const shots = await ev(`(async () => {
      const d = window.__roamDebug;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      d.setAimMode('${mode}');
      await sleep(150);
      const list = [];
      for (let rep = 0; rep < ${REPEATS}; rep += 1) {
        for (const off of ${JSON.stringify(OFFSETS)}) {
          list.push(await window.__m16Fire('${mode}', off));
        }
      }
      return list;
    })()`);
    trials[mode] = shots;
    const st = summarize(shots, mode);
    console.log(`\n[${mode}] 命中 ${st.hits}/${st.shots} (${st.hitRate}%)  输入 ${st.avgInputDeg}°  锁定偏转 ${st.avgLockDeflectDeg}°  实际剩余 ${st.avgResidualDeg}°  判定半径 ${st.hitRadius}px`);
  }
  const allShots = [...trials.off, ...trials.weak, ...trials.strong];
  const stats = {
    setup,
    generatedAt: new Date().toISOString(),
    offsets: OFFSETS,
    repeats: REPEATS,
    off: summarize(trials.off, 'off'),
    weak: summarize(trials.weak, 'weak'),
    strong: summarize(trials.strong, 'strong'),
    shots: allShots
  };
  fs.writeFileSync(path.join(OUT, 'm16-aim-trials.json'), JSON.stringify(stats, null, 2));

  // ==================== 4) 断言 ====================
  const off = stats.off;
  const weak = stats.weak;
  const strong = stats.strong;
  check('三档各完成 30 发且发射成功',
    off.shots === 30 && weak.shots === 30 && strong.shots === 30
      && allShots.every((s) => s.castOk),
    { off: off.shots, weak: weak.shots, strong: strong.shots, castAllOk: allShots.every((s) => s.castOk) });
  check('关闭档命中率 ≤ 50% 且明显低于弱辅助（≥15 个百分点）',
    off.hitRate <= 50 && weak.hitRate >= off.hitRate + 15,
    { off: off.hitRate, weak: weak.hitRate });
  check('弱辅助命中率 ≤ 95%（是"部分修正"而不是全自动）',
    weak.hitRate <= 95,
    { weak: weak.hitRate });
  check('强辅助命中率 ≥ 90% 且不低于弱辅助',
    strong.hitRate >= 90 && strong.hitRate >= weak.hitRate,
    { strong: strong.hitRate, weak: weak.hitRate });
  check('强辅助 30 发全部命中目标圈（完全对准）',
    strong.hits === 30,
    { hits: strong.hits });
  check('关闭档不锁定；弱辅助剩余偏转明显、强辅助完全对准',
    off.lockedShots === 0
      && weak.avgLockResidualDeg > 2
      && strong.avgLockResidualDeg <= 2
      && weak.avgLockResidualDeg < off.avgResidualDeg,
    { off: off.avgResidualDeg, weakLock: weak.avgLockResidualDeg, strongLock: strong.avgLockResidualDeg, locks: { off: off.lockedShots, weak: weak.lockedShots, strong: strong.lockedShots } });
  check('弱辅助剩余偏转 ≈ 输入偏转的 40%（bias 0.6 生效，误差 ≤ 3°）',
    weak.avgLockDeflectDeg > 0 && Math.abs(weak.avgLockResidualDeg - weak.avgLockDeflectDeg * 0.4) <= 3,
    { avgLockDeflect: weak.avgLockDeflectDeg, avgLockResidual: weak.avgLockResidualDeg, expect: Number((weak.avgLockDeflectDeg * 0.4).toFixed(2)) });
  check('命中半径加成三档递增（0 / 20% / 30%）',
    off.hitBonus === 0 && weak.hitBonus === 0.2 && strong.hitBonus === 0.3
      && strong.hitRadius > weak.hitRadius && weak.hitRadius > off.hitRadius,
    { off: off.hitRadius, weak: weak.hitRadius, strong: strong.hitRadius });
  const offMisses = trials.off.filter((s) => !s.hit);
  check('关闭档至少 10 发落空，且落空的弹道最近点全在判定圈外',
    offMisses.length >= 10 && offMisses.every((s) => s.minDist >= 0 && s.minDist > s.hitRadius),
    { misses: offMisses.length, sample: offMisses.slice(0, 4).map((s) => ({ d: s.minDist, r: s.hitRadius })) });

  // ==================== 5) 截图：锁定指示（弱 / 强） ====================
  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.setAimMode('weak');
    const M = window.__m16;
    const p = state.player;
    const dummy = state.enemies.find((e) => e.id === M.dummyId);
    dummy.x = p.x + Math.cos(M.dir) * M.dist;
    dummy.y = p.y + Math.sin(M.dir) * M.dist;
    dummy.vx = 0; dummy.vy = 0;
    d.setMouseAim(Math.atan2(dummy.y - p.y, dummy.x - p.x) + 15 * Math.PI / 180);
    await sleep(400);
    return d.aimState();
  })()`);
  await mouseMove(760, 430);
  await sleep(200);
  await shot('m16-lock-weak.png');
  await shotClip('m16-lock-weak-zoom.png');

  await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.setAimMode('strong');
    const M = window.__m16;
    const p = state.player;
    const dummy = state.enemies.find((e) => e.id === M.dummyId);
    dummy.x = p.x + Math.cos(M.dir) * M.dist;
    dummy.y = p.y + Math.sin(M.dir) * M.dist;
    d.setMouseAim(Math.atan2(dummy.y - p.y, dummy.x - p.x) + 15 * Math.PI / 180);
    await sleep(400);
    return d.aimState();
  })()`);
  await shot('m16-lock-strong.png');

  // ==================== 6) 收尾：恢复默认档 + 帧率 / 报错 ====================
  const finalState = await ev(`(async () => {
    const d = window.__roamDebug;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    d.setAimMode('weak');
    state.enemies.length = 0;
    await sleep(200);
    const t0 = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const tick = () => { frames += 1; if (performance.now() - t0 > 1200) resolve(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const fps = frames / ((performance.now() - t0) / 1000);
    return { fps: Number(fps.toFixed(1)), errors: d.errors(), mode: d.getState().mode };
  })()`);
  check('帧率 ≥ 60', finalState.fps >= 60, finalState.fps);
  check('运行期无报错', Array.isArray(finalState.errors) && finalState.errors.length === 0, finalState.errors);

  // 打印三档对照表（回报里直接可用）
  console.log('\n==== 三档对照（每档 30 发，靶距 ' + setup.dist + 'px，靶半径 ' + setup.radius + 'px）====');
  [off, weak, strong].forEach((s) => {
    const cells = Object.keys(s.byOffset).sort((a, b) => Number(a) - Number(b))
      .map((k) => `${k}°:${s.byOffset[k].hits}/${s.byOffset[k].shots}`).join('  ');
    console.log(`${s.mode.padEnd(6)} 命中 ${String(s.hits).padStart(2)}/30 (${String(s.hitRate).padStart(5)}%)  锁定 ${s.lockedShots}  锁定剩余偏转 ${String(s.avgLockResidualDeg).padStart(5)}°  命中半径 ${s.hitRadius}px  | ${cells}`);
  });
  console.log('\n样本 JSON：' + path.join(OUT, 'm16-aim-trials.json'));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} ${pass === results.length ? 'PASS' : 'FAIL'}`);
  try { ws.close(); } catch (e) {}
  killEdge(edge);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => { console.error('FAILED', err); process.exit(1); });
