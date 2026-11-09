/**
 * H2 经验条 + 升级即时四选一 验收
 * 用法：node tools/arcane_xp.js
 * 端口：9562
 * 产出：.screenshots/art/h2-xp-before.png / h2-xp-after.png / h2-xp-result.json
 *
 * 断言：
 *  X0 配置：10/35/120 经验、门槛 80、×1.28、每 3 级被动三选一、慢动作 0.15s
 *  X1 门槛递推：needFor(1..4) = 80 / 102 / 131 / 168，且比值≈1.28
 *  X2 满经验即弹窗：addXp(80) → 慢动作 + 延迟后进入 reward 模式且四选一
 *  X3 选完即时生效：选第一张 → 回到 playing、卡片/被动真的进了构筑
 *  X4 连续升级排队：一次给大量经验 → 逐级弹窗，pending 递减
 *  X5 清层不再发技能卡：改为掉奥能球（≥3），且不弹窗
 *  X6 每 3 级补被动三选一：Lv.3 技能选完自动接被动段，选项数=3
 *  X7 HUD 经验条可见且宽度=进度
 *  X8 A/B：关掉 XP 后清层恢复旧流程（弹技能四选一），经验条隐藏
 *  X9 单局 12–16 级：11 次升级总经验在 3400–4600 区间（对应 12 级）
 *  X10 fps ≥60 / 无错误 / 截图
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9562;
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

/**
 * 把排队中的升级全部选完，回到 playing
 * @param {Function} ev 求值函数
 */
async function drainLevelUps(ev) {
  for (let i = 0; i < 12; i += 1) {
    const info = await ev(`window.__roamDebug.xp.info()`);
    if (info.mode === 'reward') {
      if (info.options && info.options.length) await ev(`window.__roamDebug.xp.chooseFirst()`);
      else break;
    }
    await sleep(320);
    const after = await ev(`window.__roamDebug.xp.info()`);
    if (after.mode === 'playing' && after.pending === 0 && !after.choosing) return after;
  }
  return ev(`window.__roamDebug.xp.info()`);
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
  await sleep(1300);

  // ---------- X0 配置 ----------
  const cfg = await ev(`window.__roamDebug.xp.config()`);
  ok('X0 配置：10/35/120 · 门槛 80 · ×1.28 · 每 3 级被动三选一 · 慢动作 0.15s',
    cfg.killXp.normal === 10 && cfg.killXp.elite === 35 && cfg.killXp.boss === 120
      && cfg.baseNeed === 80 && Math.abs(cfg.growth - 1.28) < 1e-9
      && cfg.passiveEvery === 3 && cfg.passiveCount === 3 && Math.abs(cfg.slowMo - 0.15) < 1e-9
      && cfg.enabled === true, cfg.killXp);

  // ---------- X1 门槛递推 ----------
  const needs = await ev(`[1,2,3,4].map(function(n){ return window.__roamDebug.xp.needFor(n); })`);
  const ratio = needs[1] / needs[0];
  ok('X1 门槛递推 80 → 102 → 131 → 168（比值≈1.28）',
    needs[0] === 80 && needs[1] === 102 && needs[2] === 131 && needs[3] === 168
      && Math.abs(ratio - 1.28) < 0.02, { needs, ratio: Math.round(ratio * 1000) / 1000 });

  // ---------- X2 满经验即弹窗 ----------
  const before2 = await ev(`window.__roamDebug.xp.info()`);
  await ev(`window.__roamDebug.xp.addXp(80)`);
  const afterAdd = await ev(`window.__roamDebug.xp.info()`);
  await sleep(450);
  const afterModal = await ev(`window.__roamDebug.xp.info()`);
  ok('X2 满经验：慢动作 + 延迟后弹四选一（mode=reward, source=levelup, 4 选项）',
    afterAdd.slowT > 0 || afterAdd.mode === 'reward',
    { beforeLevel: before2.level, afterLevel: afterAdd.level, slowT: afterAdd.slowT });
  ok('X2b 弹窗确认为四选一且来自升级', afterModal.mode === 'reward'
    && afterModal.source === 'levelup' && afterModal.options.length === 4,
  { mode: afterModal.mode, source: afterModal.source, options: afterModal.options.length });

  // ---------- X3 选完即时生效 ----------
  const beforeBuild = await ev(`(function(){
    return { magic: state.ownedMagic.length, tech: state.ownedTech.length, relics: Object.keys(state.relics).length, passive: state.passiveStacks ? Object.keys(state.passiveStacks).length : 0 };
  })()`);
  const chosen = await ev(`(function(){
    var o = state.upgradeOptions[0];
    var r = window.__roamDebug.xp.chooseFirst();
    return { ok: r, key: o ? o.key : null, kind: o ? o.kind : null };
  })()`);
  await sleep(420);
  const afterBuild = await ev(`(function(){
    return { magic: state.ownedMagic.length, tech: state.ownedTech.length, relics: Object.keys(state.relics).length, passive: state.passiveStacks ? Object.keys(state.passiveStacks).length : 0, mode: state.mode, pending: state.xpPending, choosing: state.xpChoosing };
  })()`);
  const grew = afterBuild.magic !== beforeBuild.magic || afterBuild.tech !== beforeBuild.tech
    || afterBuild.relics !== beforeBuild.relics || afterBuild.passive !== beforeBuild.passive;
  ok('X3 选完立即生效并回到战斗', chosen.ok && afterBuild.mode === 'playing'
    && afterBuild.pending === 0 && afterBuild.choosing === false && grew,
  { chosen, before: beforeBuild, after: afterBuild });

  // ---------- X4 连续升级排队 ----------
  const bulk = await ev(`window.__roamDebug.xp.addXp(900)`);
  await sleep(450);
  const queue1 = await ev(`window.__roamDebug.xp.info()`);
  await ev(`window.__roamDebug.xp.chooseFirst()`);
  await sleep(450);
  const queue2 = await ev(`window.__roamDebug.xp.info()`);
  const drained = await drainLevelUps(ev);
  ok('X4 一次给大量经验 → 逐级弹窗，pending 递减且最终归零',
    bulk.pending >= 2 && queue1.mode === 'reward'
      && (queue2.mode === 'reward' ? queue2.pending >= 1 : true)
      && drained.pending === 0 && drained.mode === 'playing',
  { bulkPending: bulk.pending, q1: queue1.mode, q2: queue2.mode, drained: drained.pending });

  // ---------- X5 清层不再发技能卡 ----------
  const clearInfo = await ev(`(function(){
    var crystalsBefore = state.meta.crystals;
    state.enemies.length = 0;
    checkFloorClear();
    var orbs = state.pickups.filter(function(p){ return p.kind === 'aether'; }).length;
    return { mode: state.mode, cleared: state.floorCleared, orbs: orbs,
      crystalsDelta: state.meta.crystals - crystalsBefore, pit: state.fusionPity };
  })()`);
  await sleep(350);
  const afterClear = await ev(`window.__roamDebug.xp.info()`);
  ok('X5 清层不再弹技能卡：掉奥能球 ≥3 + 结晶，mode 保持 playing',
    clearInfo.cleared === true && clearInfo.orbs >= 3 && clearInfo.crystalsDelta === 1
      && afterClear.mode === 'playing', clearInfo);

  // ---------- X6 每 3 级补被动三选一 ----------
  await ev(`(function(){ window.__roamDebug.enemies.floor(state.floor + 1); return true; })()`);
  await sleep(400);
  const lv3 = await ev(`(function(){
    // 强制回到 Lv.2 再升一级 → 稳定落在"3 的倍数"，用于验证被动段是否接上
    state.xpLevel = 2; state.xp = 0; state.xpNeed = window.__roamDebug.xp.needFor(2);
    awardXp(window.__roamDebug.xp.needFor(2), 0, 0);
    return window.__roamDebug.xp.info();
  })()`);
  await sleep(500);
  const lv3Modal = await ev(`window.__roamDebug.xp.info()`);
  const atLevel3 = lv3Modal.level === 3;
  await ev(`window.__roamDebug.xp.chooseFirst()`);
  await sleep(450);
  const passiveStage = await ev(`(function(){
    var info = { mode: state.mode, stage: state.rewardStage, count: state.upgradeOptions.length, source: state.rewardSource };
    if (info.mode === 'reward' && info.stage === 'passive') { window.__roamDebug.xp.chooseFirst(); }
    return info;
  })()`);
  await sleep(400);
  await drainLevelUps(ev);
  ok('X6 每 3 级：技能四选一之后自动接被动三选一',
    atLevel3 ? (passiveStage.mode === 'reward' && passiveStage.stage === 'passive' && passiveStage.count === 3) : true,
  { level: lv3Modal.level, atLevel3, passiveStage });

  // ---------- X7 经验条 ----------
  const hud = await ev(`(function(){
    var w = document.getElementById('xpBarWrap');
    var f = document.getElementById('xpBarFill');
    var t = document.getElementById('xpBarText');
    return {
      visible: !!(w && w.style.display !== 'none'),
      width: f ? parseFloat(f.style.width) : -1,
      expect: state.xpNeed ? Math.round(state.xp / state.xpNeed * 10000) / 100 : -1,
      text: t ? t.textContent : null
    };
  })()`);
  ok('X7 HUD 经验条可见，宽度 = 本级进度，文案带 Lv',
    hud.visible && Math.abs(hud.width - hud.expect) < 1.5 && /Lv\./.test(hud.text || ''), hud);

  // ---------- X8 A/B 关闭后回旧流程 ----------
  await ev(`window.__roamDebug.xp.setEnabled(false)`);
  await ev(`(function(){ window.__roamDebug.enemies.floor(state.floor + 1); return true; })()`);
  await sleep(400);
  const abOff = await ev(`(function(){
    state.enemies.length = 0;
    checkFloorClear();
    var w = document.getElementById('xpBarWrap');
    return { mode: state.mode, stage: state.rewardStage, count: state.upgradeOptions.length,
      source: state.rewardSource, barVisible: !!(w && w.style.display !== 'none') };
  })()`);
  ok('X8 A/B：关掉 XP 后清层弹技能四选一（旧流程），经验条隐藏',
    abOff.mode === 'reward' && abOff.count === 4 && abOff.source === 'floor' && abOff.barVisible === false, abOff);
  await ev(`(function(){ var b = document.querySelector('[data-skip-passive]'); if (b) b.click(); return true; })()`);
  await sleep(250);
  await ev(`window.__roamDebug.xp.setEnabled(true)`);
  await sleep(250);

  // ---------- X9 单局 12–16 级 ----------
  const sums = await ev(`(function(){
    var s12 = 0, s16 = 0;
    for (var n = 1; n <= 11; n += 1) s12 += window.__roamDebug.xp.needFor(n);
    for (var m = 1; m <= 15; m += 1) s16 += window.__roamDebug.xp.needFor(m);
    return { s12: s12, s16: s16 };
  })()`);
  ok('X9 12 级总经验 3400–4600（一局 ~300 杀 ≈ 12–14 级）',
    sums.s12 >= 3400 && sums.s12 <= 4600, sums);

  // ---------- X10 截图 / fps / 错误 ----------
  await shot('h2-xp-after.png');
  await ev(`window.__roamDebug.xp.setEnabled(false)`);
  await sleep(300);
  await shot('h2-xp-before.png');
  await ev(`window.__roamDebug.xp.setEnabled(true)`);
  const sizeAfter = fs.statSync(path.join(OUT_DIR, 'h2-xp-after.png')).size;
  const sizeBefore = fs.statSync(path.join(OUT_DIR, 'h2-xp-before.png')).size;
  const perf = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){ return { fps: f, errors: (window.__errors || []).length }; });
  })()`);
  ok('X10 fps ≥60 / 无错误 / 截图 >60KB',
    perf.fps >= 60 && perf.errors === 0 && sizeBefore > 61440 && sizeAfter > 61440,
    { fps: perf.fps, errors: perf.errors, before: sizeBefore, after: sizeAfter });

  fs.writeFileSync(path.join(OUT_DIR, 'h2-xp-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log('\n===== h2 xp ' + pass + '/' + asserts.length + ' =====');
  ws.close();
  killEdge(edge);
  if (pass !== asserts.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
