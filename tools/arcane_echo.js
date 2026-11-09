/**
 * P4 残响回路验收：A0–A7
 * 用法：node tools/arcane_echo.js
 * 端口：9515
 * 输出：.screenshots/art/p4-echo.png、p4-echo-result.json
 *
 * 断言顺序：
 *  A0 初始态    A1 施法生成（坐标/生命）  A2 脉冲次数与单次伤害
 *  A3 上限挤出  A4 敌人踩碎              A5 不触发过载/不新增施法
 *  A6 20 个压力 A7 A/B 开关
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9515;
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
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge 起来 */ }
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1400);

  // ---------- 全局准备：关暴击（避免 A2/A3 的伤害断言被随机倍率打断）+ 无敌 ----------
  await ev(`(function(){
    state.player.invuln = 9999;
    window.__echoCritBak = FEEL_CONFIG.critChance;
    FEEL_CONFIG.critChance = 0;
    state.fusions = [];
    state.ownedMagic = ['fireball'];
    state.ownedTech = ['concentrator'];
    state.dual = { slots: ['fireball', null], focus: 0, switchCd: 0, castingSlot: 0, stats: { casts: [0, 0], skips: 0 }, notice: false };
    state.echoes = [];
    return true;
  })()`);

  // ---------- A0：初始态 ----------
  const a0 = await ev(`(function(){
    return {
      enabled: ECHO_CONFIG.enabled,
      summary: window.__roamDebug.echo.info(),
      hasArray: Array.isArray(state.echoes)
    };
  })()`);
  ok('A0 初始态：开关开 / echoes 为空 / 数组存在',
    a0.enabled === true && a0.hasArray === true && a0.summary.count === 0
      && a0.summary.max === 2 && a0.summary.life === 6, a0);

  // ---------- A1：真实施法（融合）→ 施法点生成 1 个残响 ----------
  const a1 = await ev(`(function(){
    state.echoes = [];
    state.fusions = [];
    var fused = window.__roamDebug.overdrive.fuse();   // 走真实 tryFuse（fireball + concentrator）
    state.cooldowns = {};
    state.player.aether = state.player.aetherMax;
    state.activeMagicId = 'fireball';
    state.player.angle = 0;
    var cast = castPrimary();
    var info = window.__roamDebug.echo.info();
    var p = state.player;
    var e = info.list[0] || null;
    return {
      fused: fused, cast: cast, info: info, player: { x: p.x, y: p.y },
      dx: e ? Math.abs(e.x - p.x) : 999, dy: e ? Math.abs(e.y - p.y) : 999
    };
  })()`);
  ok('A1 融合施法 → 1 个残响 / 坐标=施法点(≤8px) / 生命≈6',
    a1.fused === true && a1.cast === true && a1.info.count === 1
      && a1.dx <= 8 && a1.dy <= 8
      && a1.info.list[0].life >= 5.85 && a1.info.list[0].life <= 6.0, a1);

  // ---------- A2：3.2s 内 ≥2 次脉冲，单次伤害 ≈ pulseDamage ----------
  await ev(`(function(){
    // 清掉 A1 留下的火球弹体：它会飞向靶子，把伤害断言污染成「弹体 + 脉冲」
    state.projectiles = [];
    state.bullets = [];
    var p = state.player;
    window.__echoTarget = {
      id: 'echoTarget', typeId: 'echoProbe', name: '残响靶',
      x: p.x + 60, y: p.y, radius: 12, hp: 99999, hpMax: 99999,
      vx: 0, vy: 0, speed: 0, damage: 0, color: '#ffffff',
      aiV2: null, shieldHp: 0, mark: null, coreOpen: 0, isBoss: false, wobble: 0
    };
    state.enemies.push(window.__echoTarget);
    // 每 40ms 把靶钉回原位（敌人 AI 可能会把它推向玩家）
    window.__echoPin = setInterval(function(){
      var t = window.__echoTarget; if (!t) return;
      t.x = state.player.x + 60; t.y = state.player.y; t.vx = 0; t.vy = 0;
    }, 40);
    return { hp: window.__echoTarget.hp };
  })()`);
  await sleep(3300);
  await shot('p4-echo.png');
  const a2 = await ev(`(function(){
    var t = window.__echoTarget;
    clearInterval(window.__echoPin);
    var info = window.__roamDebug.echo.info();
    var e = info.list[0] || null;
    var lost = t ? (99999 - t.hp) : -1;
    return {
      pulses: e ? e.pulses : 0, pulseDamage: e ? e.pulseDamage : 0,
      lost: lost, hits: e && e.pulses ? lost / e.pulses : 0,
      count: info.count, life: e ? e.life : 0
    };
  })()`);
  ok('A2 3.2s 内脉冲 ≥2 次，单次伤害 ≈ 融合基础伤害×0.3（±10%）',
    a2.count === 1 && a2.pulses >= 2 && a2.pulseDamage > 0
      && Math.abs(a2.hits - a2.pulseDamage) / a2.pulseDamage <= 0.1, a2);

  // ---------- A3：第 3 个生成 → 上限 2 / 最早被挤出 / 碎裂造成 0.5 倍伤害 ----------
  const a3 = await ev(`(function(){
    window.__roamDebug.echo.clear();
    var t = window.__echoTarget;
    if (t) {
      t.hp = 99999; t.x = state.player.x + 60; t.y = state.player.y; t.vx = 0; t.vy = 0;
    }
    var p = state.player;
    var s1 = window.__roamDebug.echo.spawn('fireball', 'homingFireball', p.x, p.y);
    var s2 = window.__roamDebug.echo.spawn('fireball', 'homingFireball', p.x, p.y);
    var s3 = window.__roamDebug.echo.spawn('fireball', 'homingFireball', p.x, p.y);
    var info = window.__roamDebug.echo.info();
    var lost = t ? (99999 - t.hp) : -1;
    return {
      spawned: [!!s1, !!s2, !!s3], count: info.count, last: info.last,
      breakDamage: info.list[0] ? info.list[0].breakDamage : 0, lost: lost,
      idsDiffer: (s1 && s2 && s3) ? true : false
    };
  })()`);
  const a3pass = a3.count === 2 && a3.last && a3.last.cause === 'evict'
    && a3.breakDamage > 0 && Math.abs(a3.lost - Math.round(a3.breakDamage)) <= 1;
  ok('A3 第 3 个 → 只留 2 个 / 最早 evict 碎裂 / 波及伤害≈0.5 倍',
    a3pass, a3);

  // ---------- A4：敌人踩碎 ----------
  const a4 = await ev(`(function(){
    window.__roamDebug.echo.clear();
    var t = window.__echoTarget;
    t.hp = 99999;
    t.x = state.player.x; t.y = state.player.y; t.vx = 0; t.vy = 0;
    var e = window.__roamDebug.echo.spawn('fireball', 'homingFireball', state.player.x, state.player.y);
    var breakDamage = e ? e.breakDamage : 0;
    return { spawned: !!e, breakDamage: breakDamage, hpBefore: t.hp };
  })()`);
  await sleep(260);
  const a4b = await ev(`(function(){
    var t = window.__echoTarget;
    var info = window.__roamDebug.echo.info();
    var lost = 99999 - t.hp;
    return { count: info.count, last: info.last, lost: lost };
  })()`);
  ok('A4 敌人接触 → 节点立即消失 / last=touch / 敌人吃 0.5 倍伤害',
    a4b.count === 0 && a4b.last && a4b.last.cause === 'touch'
      && Math.abs(a4b.lost - Math.round(a4.breakDamage)) <= 1, { a4, a4b });

  // ---------- A5：残响不触发过载 / 不新增施法 / 不生成二次残响 ----------
  const a5a = await ev(`(function(){
    window.__roamDebug.echo.clear();
    var t = window.__echoTarget;
    t.hp = 99999; t.x = state.player.x + 60; t.y = state.player.y; t.vx = 0; t.vy = 0;
    window.__roamDebug.echo.spawn('fireball', 'homingFireball', state.player.x, state.player.y);
    var od = state.overdrive;
    var dualStats = { casts: (state.dual.stats.casts || []).slice(), skips: state.dual.stats.skips };
    return {
      used: od ? od.used : 0, buff: od ? od.buffTime : 0,
      casts: dualStats.casts, skips: dualStats.skips, count: window.__roamDebug.echo.info().count
    };
  })()`);
  await sleep(2000);
  const a5b = await ev(`(function(){
    var od = state.overdrive;
    var info = window.__roamDebug.echo.info();
    return {
      used: od ? od.used : 0, buff: od ? od.buffTime : 0,
      casts: (state.dual.stats.casts || []).slice(), skips: state.dual.stats.skips,
      count: info.count, pulses: info.list[0] ? info.list[0].pulses : 0
    };
  })()`);
  ok('A5 脉冲期间：过载次数不变 / 无自动施法 / 不新增残响',
    a5a.used === a5b.used && a5a.buff === 0 && a5b.buff === 0
      && a5a.casts.join(',') === a5b.casts.join(',')
      && a5a.skips === a5b.skips
      && a5b.count === 1 && a5b.pulses >= 1, { before: a5a, after: a5b });

  // ---------- A6：压力（上限临时调 20） ----------
  const a6 = await ev(`(function(){
    window.__roamDebug.echo.clear();
    // 压力段不需要测试靶：靶子缺渲染字段，会在 drawEnemies 里制造无关报错
    clearInterval(window.__echoPin);
    if (window.__echoTarget) {
      state.enemies = state.enemies.filter(function(e){ return e !== window.__echoTarget; });
      window.__echoTarget = null;
    }
    ECHO_CONFIG.maxCount = 20;
    var p = state.player;
    for (var i = 0; i < 20; i += 1) {
      window.__roamDebug.echo.spawn('fireball', 'homingFireball',
        p.x + Math.cos(i * 0.314) * 40, p.y + Math.sin(i * 0.314) * 40);
    }
    // 基线：前面 A1–A5 的测试靶缺渲染字段，可能已在 drawEnemies 里留下无关报错；
    // 压力段要看的是「有没有新增错误」，不是历史错误总数。
    return Object.assign({ errBase: (window.__errors || []).length }, window.__roamDebug.echo.info());
  })()`);
  await sleep(2000);
  const a6b = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){
      ECHO_CONFIG.maxCount = 2;
      var info = window.__roamDebug.echo.info();
      return {
        fps: f, errors: (window.__errors || []).length,
        errList: (window.__errors || []).slice(0, 3),
        count: info.count
      };
    });
  })()`);
  ok('A6 20 个残响压力：压力段无新增错误 / fps≥50 / 2s 后仍存在',
    a6b.errors === a6.errBase && a6b.fps >= 50 && a6b.count >= 1, { spawn: a6.count, base: a6.errBase, after: a6b });

  // ---------- A7：A/B（关闭后融合施法不生成，开回来生成 1 个） ----------
  const a7 = await ev(`(function(){
    window.__roamDebug.echo.clear();
    state.status = 'playing'; state.mode = 'playing';
    ECHO_CONFIG.enabled = false;
    state.cooldowns = {};
    state.player.aether = state.player.aetherMax;
    state.activeMagicId = 'fireball';
    var castOff = castPrimary();
    var off = window.__roamDebug.echo.info();
    ECHO_CONFIG.enabled = true;
    state.cooldowns = {};
    state.player.aether = state.player.aetherMax;
    var castOn = castPrimary();
    var on = window.__roamDebug.echo.info();
    return { castOff: castOff, offCount: off.count, castOn: castOn, onCount: on.count };
  })()`);
  ok('A7 A/B：关闭时 0 个 / 开启后 1 个',
    a7.castOff === true && a7.offCount === 0 && a7.castOn === true && a7.onCount === 1, a7);

  // 收尾：恢复暴击与清理靶子
  await ev(`(function(){
    FEEL_CONFIG.critChance = window.__echoCritBak == null ? 0.12 : window.__echoCritBak;
    clearInterval(window.__echoPin);
    if (window.__echoTarget) {
      state.enemies = state.enemies.filter(function(e){ return e !== window.__echoTarget; });
    }
    window.__roamDebug.echo.clear();
    return true;
  })()`);

  fs.writeFileSync(path.join(OUT_DIR, 'p4-echo-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'p4-echo.png')).size; } catch (e) { shotSize = 0; }
  console.log('\n===== p4-echo ' + pass + '/' + asserts.length + ' ===== (shot ' + shotSize + 'B)');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
