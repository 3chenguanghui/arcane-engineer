/**
 * P3 并联回路验收：A1–A6
 * 用法：node tools/arcane_dualcast.js
 * 端口：9514
 * 输出：.screenshots/art/p3-dualcast.png、p3-dualcast-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9514;
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
  await ev(`(function(){
    state.player.invuln = 9999;
    /* 前置：融合 / 过载必须已解锁（断言本身不改弱，只补环境） */
    if (state.meta && state.meta.unlocks) { state.meta.unlocks.fusion = true; state.meta.unlocks.overdrive = true; }
    /* R · 开局随机化后起始卡不再固定火球：这里补足前置（断言本身不改弱） */
    if (state.ownedMagic.indexOf('fireball') < 0) state.ownedMagic.unshift('fireball');
    if (state.ownedMagic.indexOf('frost') < 0) state.ownedMagic.push('frost');
    if (state.ownedTech.indexOf('amp') < 0) state.ownedTech.push('amp');
    state.dual = { slots: ['fireball', 'frost'], focus: 0, switchCd: 0, castingSlot: 0, stats: { casts: [0, 0], skips: 0 }, notice: false };
    state.activeMagicId = 'fireball';
    state.cooldowns = {};
    renderDeck();
    return true;
  })()`);

  // ---------- A0：卡面主/副角标 + focus 描边 ----------
  const a0 = await ev(`(function(){
    var main = document.querySelectorAll('.mini-card.is-slot-main').length;
    var sub = document.querySelectorAll('.mini-card.is-slot-sub').length;
    var focus = document.querySelectorAll('.mini-card.is-slot-focus').length;
    return { main: main, sub: sub, focus: focus, slots: state.dual.slots.slice() };
  })()`);
  ok('A0 卡面出现主/副角标与 focus 描边', a0.main === 1 && a0.sub === 1 && a0.focus === 1, a0);

  // ---------- A1：3 秒双卡自动咏唱，两槽都出手 ----------
  const a1 = await ev(`(function(){
    state.dual.stats = { casts: [0, 0], skips: 0 };
    state.cooldowns = {};
    for (var i = 0; i < 30; i += 1) {
      state.player.aether = state.player.aetherMax;
      update(0.1);
      window.__roamDebug.dual.cast();
    }
    return { stats: state.dual.stats, info: window.__roamDebug.dual.info() };
  })()`);
  ok('A1 3 秒内主/副两槽都施法（casts 均 ≥1）',
    a1.stats.casts[0] >= 1 && a1.stats.casts[1] >= 1, a1);

  // ---------- A2：副槽 0.8 伤害 / 1.45 冷却 ----------
  const a2 = await ev(`(function(){
    var dmg0 = window.__roamDebug.dual.damage('fireball', 0);
    var dmg1 = window.__roamDebug.dual.damage('fireball', 1);
    state.cooldowns = {};
    state.player.aether = state.player.aetherMax;
    window.__roamDebug.dual.cast();
    var frostBase = MAGIC_BY_ID.frost.cooldown * state.mods.cooldownMul;
    return {
      dmg0: dmg0, dmg1: dmg1, ratio: dmg1 / dmg0,
      frostCd: state.cooldowns.frost, frostBase: frostBase, cdRatio: state.cooldowns.frost / frostBase
    };
  })()`);
  ok('A2 副槽伤害 ×0.8、冷却 ×1.45',
    Math.abs(a2.ratio - 0.8) < 0.02 && Math.abs(a2.cdRatio - 1.45) < 0.03, a2);

  // ---------- A3：奥能只够一发 → 只有主槽施法，绝不负数 ----------
  const a3 = await ev(`(function(){
    state.cooldowns = {};
    state.dual.stats = { casts: [0, 0], skips: 0 };
    state.player.aether = MAGIC_BY_ID.fireball.cost + 1;
    var okCast = window.__roamDebug.dual.cast();
    return {
      okCast: okCast, aether: state.player.aether, stats: state.dual.stats,
      fireballCost: MAGIC_BY_ID.fireball.cost, frostCost: MAGIC_BY_ID.frost.cost
    };
  })()`);
  ok('A3 奥能不够副槽 → 只主槽出手、副槽计数不变、奥能不负',
    a3.okCast === true && a3.stats.casts[0] === 1 && a3.stats.casts[1] === 0
      && a3.aether >= 0, a3);

  // ---------- A4：Tab 换相 + 0.35s 硬直 ----------
  const a4 = await ev(`(function(){
    state.cooldowns = {};
    state.player.aether = state.player.aetherMax;
    state.dual.switchCd = 0;
    var okSwap = window.__roamDebug.dual.focus();
    var focusAfter = state.dual.focus;
    var cdAfterSwap = state.dual.switchCd;
    var blocked = window.__roamDebug.dual.cast();
    for (var i = 0; i < 30; i += 1) update(1 / 60);
    state.cooldowns = {};
    state.player.aether = state.player.aetherMax;
    var resumed = window.__roamDebug.dual.cast();
    return { okSwap: okSwap, focusAfter: focusAfter, cdAfterSwap: cdAfterSwap, blocked: blocked, resumed: resumed, activeMagicId: state.activeMagicId };
  })()`);
  ok('A4 Tab 换相成功 / 硬直内停手 / 0.35s 后恢复',
    a4.okSwap === true && a4.focusAfter === 1 && a4.cdAfterSwap > 0.3
      && a4.blocked === false && a4.resumed === true && a4.activeMagicId === 'frost', a4);

  // ---------- A5：融合只落在焦点槽，另一槽伤害不变 ----------
  const a5 = await ev(`(function(){
    var before = window.__roamDebug.dual.damage('fireball', 0);
    var fusionsBefore = state.fusions.length;
    var fused = window.__roamDebug.overdrive.fuse();
    var after = window.__roamDebug.dual.damage('fireball', 0);
    return {
      fused: fused, fusionsBefore: fusionsBefore, fusionsAfter: state.fusions.length,
      before: before, after: after, activeMagicId: state.activeMagicId
    };
  })()`);
  ok('A5 融合只作用于当前焦点槽（fusions +1，另一槽伤害不变）',
    a5.fused === true && a5.fusionsAfter === a5.fusionsBefore + 1
      && a5.activeMagicId === 'frost' && Math.abs(a5.after - a5.before) < 0.01, a5);

  // ---------- A6：A/B 开关（关掉后副槽不施法）+ 无错误 + 帧率 + 截图 ----------
  const a6 = await ev(`(function(){
    DUAL_CONFIG.enabled = false;
    state.cooldowns = {};
    state.player.aether = state.player.aetherMax;
    state.dual.stats = { casts: [0, 0], skips: 0 };
    var okCast = window.__roamDebug.dual.cast();
    // 深拷贝快照：后面重新打开 DUAL 再施法会改写同一个 stats 对象
    var offStats = { casts: state.dual.stats.casts.slice(), skips: state.dual.stats.skips };
    DUAL_CONFIG.enabled = true;
    // 打开后补打几发，给截图留下双卡视觉
    state.cooldowns = {};
    state.player.aether = state.player.aetherMax;
    window.__roamDebug.dual.cast();
    return { okCast: okCast, offStats: offStats, errors: (window.__errors || []).length };
  })()`);
  await sleep(120);
  await shot('p3-dualcast.png');
  const fps = await ev(`(function(){
    return new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
  })()`);
  const errors = await ev(`(window.__errors || []).length`);
  let size = 0;
  try { size = fs.statSync(path.join(OUT_DIR, 'p3-dualcast.png')).size; } catch (e) { size = 0; }
  ok('A6 A/B 关闭后副槽不施法 / 无错误 / fps≥60 / 截图>10KB',
    a6.okCast === true && a6.offStats.casts[0] === 1 && a6.offStats.casts[1] === 0
      && errors === 0 && fps >= 60 && size > 10240,
    { a6, fps, errors, size });

  fs.writeFileSync(path.join(OUT_DIR, 'p3-dualcast-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== p3-dualcast ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
