/**
 * 第 25 项 · 近战武器系统验收（W1–W16）
 * 用法：node tools/arcane_weapons.js
 * 端口：9539
 * 输出：.screenshots/art/weapons.png、weapons-result.json
 *
 * 口径：所有形态验证都用"同一颗种子 + 同一假人布局"做对照；
 * DPS 三口径直接读页面里的 weaponDpsReport，不在脚本里复制公式。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9539;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
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
  /**
   * 发送 CDP 命令并等待返回
   * @param {string} method CDP 方法
   * @param {Object} [params] 参数
   * @returns {Promise<Object>} 结果
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 在页面里执行表达式并返回值
   * @param {string} expression JS 表达式
   * @returns {Promise<*>} 返回值
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /**
   * 截图存盘
   * @param {string} name 文件名
   * @returns {Promise<void>}
   */
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
  await sleep(1200);
  await ev(`window.__errors = []; true`);

  // ---------- X-B 默认关闭 → 临时开启（旧断言 W1–W18 全部保留，不删不弱） ----------
  const xOff = await ev(`(function(){
    var d = window.__roamDebug;
    var info = d.weapons.info();
    var row = document.getElementById('weaponSettingRow');
    var chip = document.getElementById('weaponChip');
    var modeRow = document.getElementById('weaponModeRow');
    return {
      codeEnabled: info.codeEnabled, effective: info.effective,
      rowHidden: row ? getComputedStyle(row).display === 'none' : true,
      chipHidden: chip ? getComputedStyle(chip).display === 'none' : true,
      modeRowHidden: modeRow ? (modeRow.hidden || getComputedStyle(modeRow).display === 'none') : true,
      tag: d.fusion.currentTag(),
      activeFusions: activeFusionList().length, allFusions: FUSION_CONFIG.length,
      tagRecipes: FUSION_CONFIG.filter(function(f){ return !!f.weaponTag; }).length
    };
  })()`);
  ok('X-B1 默认关闭：代码闸门 false / 界面入口隐藏 / 融合退回两输入 / 5 条武器配方不可合',
    xOff.codeEnabled === false && xOff.effective === false
      && xOff.rowHidden && xOff.chipHidden && xOff.modeRowHidden
      && xOff.tag === null && xOff.activeFusions === xOff.allFusions - xOff.tagRecipes, xOff);

  await ev(`window.__roamDebug.weapons.setCode(true); window.__roamDebug.weapons.setEnabled(true); true`);
  const xOn = await ev(`(function(){
    var d = window.__roamDebug;
    return { info: d.weapons.info(), tag: d.fusion.currentTag(),
      activeFusions: activeFusionList().length, allFusions: FUSION_CONFIG.length };
  })()`);
  ok('X-B2 临时开启后武器路径仍自洽（13 条两输入配方 / 目录 = 可合数）',
    xOn.info.codeEnabled === true && xOn.info.effective === true
      && xOn.activeFusions === xOn.allFusions && xOn.allFusions === 13, xOn);

  // ---------- W1 配置完整 ----------
  const w1 = await ev(`window.__roamDebug.weapons.config()`);
  const reqFields = ['id', 'name', 'short', 'shape', 'damage', 'cooldown', 'reach', 'arc', 'hits', 'color', 'desc'];
  const modsOk = w1.mods.length === 4 && w1.mods.every((m) => m.id && m.name && m.floor > 0 && m.desc);
  ok('W1 配置：5 把武器 / 4 条改造 / 字段齐全 / 总开关与三口径验收带存在',
    w1.enabled === true && w1.weapons.length === 5 && modsOk
      && w1.weapons.every((def) => reqFields.every((f) => def[f] !== undefined))
      && w1.dps.singleMin > 0 && w1.dps.realMax > w1.dps.realMin
      && w1.dps.uptime === 0.60, {
      weapons: w1.weapons.map((x) => x.id), mods: w1.mods.map((m) => m.id), dps: w1.dps
    });

  // ---------- W2 形态两两不同 ----------
  const w2 = await ev(`(function(){
    var cfg = window.__roamDebug.weapons.config();
    var shapes = {};
    cfg.weapons.forEach(function(def){ shapes[def.shape] = true; });
    var rows = window.__roamDebug.weapons.dps({});
    var sorted = rows.slice().sort(function(a, b){ return a.single - b.single; });
    var gaps = [];
    for (var i = 1; i < sorted.length; i += 1) {
      gaps.push(Number(((sorted[i].single - sorted[i - 1].single) / sorted[i - 1].single).toFixed(3)));
    }
    var pairs = {};
    cfg.weapons.forEach(function(def){
      pairs[def.shape + '|' + def.damage + '|' + def.cooldown + '|' + def.reach] = true;
    });
    return { shapes: Object.keys(shapes), gaps: gaps, distinctPairs: Object.keys(pairs).length, rows: rows };
  })()`);
  ok('W2 形态：至少 3 种挥击形状、5 组参数全不同、单体 DPS 相邻差值均 ≥8%',
    w2.shapes.length >= 3 && w2.distinctPairs === 5
      && w2.gaps.every((g) => g >= 0.08),
    { shapes: w2.shapes, gaps: w2.gaps, distinctPairs: w2.distinctPairs });

  // ---------- W3 标题页 5 把武器可点、写入 meta ----------
  const w3 = await ev(`(function(){
    var box = document.getElementById('weaponModes');
    var btns = box ? box.querySelectorAll('button') : [];
    var hammer = box ? box.querySelector('[data-weapon="hammer"]') : null;
    if (hammer) hammer.click();
    var stored = JSON.parse(localStorage.getItem(GAME_CONFIG.metaKey) || '{}');
    var active = box ? box.querySelector('.is-active') : null;
    return {
      count: btns.length,
      metaId: stored.weaponId,
      activeId: active ? active.getAttribute('data-weapon') : null,
      note: document.getElementById('weaponNote').textContent.slice(0, 12)
    };
  })()`);
  ok('W3 标题页：5 个按钮、点战锤后 meta.weaponId=hammer、高亮同步',
    w3.count === 5 && w3.metaId === 'hammer' && w3.activeId === 'hammer', w3);

  await ev(`restartRun(); true`);
  await sleep(900);

  // ---------- W4 新开一局继承 meta 武器 ----------
  const w4 = await ev(`window.__roamDebug.weapons.info()`);
  ok('W4 开局继承：重开后本局武器 = meta 里的 hammer，连段/冷却归零',
    w4.id === 'hammer' && w4.metaWeaponId === 'hammer'
      && w4.combo === 0 && w4.cd === 0 && w4.effective === true, w4);

  // ---------- W5 键盘 Q 真实触发 ----------
  const w5 = await ev(`(function(){
    var w = window.__roamDebug.weapons;
    w.set('dagger', true);
    w.setMods({});
    state.enemies = [];
    state.weapon.combo = 0;
    state.weapon.comboTimer = 0;
    state.weapon.cd = 0;
    var before = w.info().stats.swings;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    var after = w.info();
    return { before: before, swings: after.stats.swings, cd: after.cd, whiffs: after.stats.whiffs, mode: after.mode, status: after.status };
  })()`);
  ok('W5 键盘 Q：真实 keydown 触发一次挥击，进入冷却并记空挥',
    w5.swings === w5.before + 1 && w5.cd > 0.2 && w5.whiffs >= 1, w5);
  await sleep(500);

  // ---------- W6 冷却中输入缓冲 ----------
  const w6 = await ev(`(function(){
    var w = window.__roamDebug.weapons;
    w.set('dagger', true);
    state.weapon.cd = 0.9;
    state.weapon.queued = 0;
    var before = w.info().stats.swings;
    var first = w.attack();
    var queued = w.info().queued;
    return { first: first, queued: queued, before: before };
  })()`);
  await sleep(1100);
  const w6b = await ev(`window.__roamDebug.weapons.info()`);
  ok('W6 输入缓冲：冷却中按 Q 缓存 0.16s，冷却结束自动补发一次',
    w6.first === false && w6.queued > 0.1 && w6b.stats.swings >= w6.before + 1, { w6, after: w6b.stats });

  // ---------- W7 短刃三段连段（第三段 ×1.35） ----------
  const w7 = await ev(`(function(){
    var d = window.__roamDebug;
    d.weapons.set('dagger', true);
    d.weapons.setMods({});
    state.enemies = [];
    d.spawnEnemy('wanderer', 40, 0);
    var e = state.enemies[0];
    e.hp = e.hpMax = 1000000;
    state.weapon.combo = 0;
    state.weapon.comboTimer = 0;
    var a = d.weapons.swing({ probe: true, angle: 0 }).damage;
    var b = d.weapons.swing({ probe: true, angle: 0 }).damage;
    var c = d.weapons.swing({ probe: true, angle: 0 }).damage;
    var info = d.weapons.info();
    return { a: a, b: b, c: c, ratio: c / a, combo: info.combo };
  })()`);
  ok('W7 三段连段：连续三次挥击，第三段伤害 / 第一段 ∈ [1.30, 1.40]',
    w7.ratio >= 1.30 && w7.ratio <= 1.40 && w7.combo === 0, w7);

  // ---------- W8 镜像双刃前后双弧 ----------
  const w8 = await ev(`(function(){
    var d = window.__roamDebug;
    d.weapons.set('twin', true);
    d.weapons.setMods({});
    state.enemies = [];
    d.spawnEnemy('wanderer', 42, 0);
    d.spawnEnemy('wanderer', -42, 0);
    state.enemies.forEach(function(e){ e.hp = e.hpMax = 1000000; });
    var real = d.weapons.swing({ probe: true, angle: 0 });
    var ids = d.weapons.hits('twin');
    var front = d.weapons.hits('dagger');
    return { realHits: real.hits, realTargets: real.angles.length, twinLayout: ids.length, twinIds: ids, daggerLayout: front.length };
  })()`);
  ok('W8 双刃：一次挥击覆盖前后各 1 只（2 目标 × 每弧 2 段 = 4 次命中）；标准布局命中 4 只（前 2 + 后 2）',
    w8.realHits === 4 && w8.realTargets === 2 && w8.twinLayout === 4 && w8.daggerLayout === 4,
    { realHits: w8.realHits, realTargets: w8.realTargets, twinIds: w8.twinIds, daggerLayout: w8.daggerLayout });

  // ---------- W9 长枪直线贯穿 ----------
  const w9 = await ev(`(function(){
    var d = window.__roamDebug;
    d.weapons.set('spear', true);
    d.weapons.setMods({});
    state.enemies = [];
    d.spawnEnemy('wanderer', 40, 0);
    d.spawnEnemy('wanderer', 85, 0);
    d.spawnEnemy('wanderer', 130, 0);
    state.enemies.forEach(function(e){ e.hp = e.hpMax = 1000000; });
    var real = d.weapons.swing({ probe: true, angle: 0 });
    return { hits: real.hits, layout: d.weapons.hits('spear').length };
  })()`);
  ok('W9 长枪：一条直线上的 3 只全部贯穿；标准布局命中 3 只（正前三点）',
    w9.hits === 3 && w9.layout === 3, w9);

  // ---------- W10 战锤强击退 ----------
  const w10 = await ev(`(function(){
    var d = window.__roamDebug;
    function pushOf(id) {
      d.weapons.set(id, true);
      d.weapons.setMods({});
      state.enemies = [];
      d.spawnEnemy('wanderer', 50, 0);
      var e = state.enemies[0];
      e.hp = e.hpMax = 1000000;
      e.vx = 0; e.vy = 0;
      d.weapons.swing({ probe: true, angle: 0 });
      return e.vx;
    }
    var hammer = pushOf('hammer');
    var dagger = pushOf('dagger');
    return { hammer: hammer, dagger: dagger, ratio: hammer / (Math.abs(dagger) || 1) };
  })()`);
  ok('W10 战锤击退：单次挥击给敌人的推力 ≥ 短刃的 1.3 倍',
    w10.hammer > 0 && w10.ratio >= 1.3, w10);

  // ---------- W11 四条改造按层自动装配、只增不减 ----------
  const w11 = await ev(`(function(){
    var d = window.__roamDebug.weapons;
    d.setMods({});
    var at12 = d.grant(12);
    var modsAfter = d.info().mods;
    var back = d.grant(2);
    var still = d.info().mods;
    return {
      granted: at12.map(function(m){ return m.id; }),
      after: modsAfter,
      backCount: back.length,
      still: still
    };
  })()`);
  ok('W11 改造：grant(12) 一次装配 4 条；回退到 2 层不再补发也不清空',
    w11.granted.length === 4 && w11.backCount === 0
      && ['edge', 'swift', 'reach', 'sunder'].every((id) => w11.still[id] === true), w11);

  // ---------- W12 破甲对护盾 ×1.40 ----------
  const w12 = await ev(`(function(){
    var d = window.__roamDebug;
    function hitWith(sunder) {
      d.weapons.set('spear', true);
      d.weapons.setMods(sunder ? { sunder: true } : {});
      state.enemies = [];
      d.spawnEnemy('wanderer', 45, 0);
      var e = state.enemies[0];
      e.hp = e.hpMax = 1000000;
      e.shieldHp = 800;
      var snap = d.weapons.swing({ probe: true, angle: 0 });
      return snap.damage;
    }
    var plain = hitWith(false);
    var sunder = hitWith(true);
    return { plain: plain, sunder: sunder, ratio: sunder / plain };
  })()`);
  ok('W12 破甲：带护盾目标伤害 / 无破甲 ∈ [1.35, 1.45]',
    w12.ratio >= 1.35 && w12.ratio <= 1.45, w12);

  // ---------- W13 三口径 DPS 表 ----------
  const w13 = await ev(`window.__roamDebug.weapons.dps({})`);
  const singles = w13.map((r) => r.single);
  const reals = w13.map((r) => r.real);
  const groups = w13.map((r) => r.group);
  const groupMuls = w13.map((r) => r.group / r.single);
  ok('W13 三口径：单体 30–60 / 实战 18–50 / 群怪 ≥1.15× 单体、双刃与长枪 ≥1.30×',
    w13.length === 5
      && singles.every((v) => v >= w1.dps.singleMin && v <= w1.dps.singleMax)
      && reals.every((v) => v >= w1.dps.realMin && v <= w1.dps.realMax)
      && groupMuls.every((v) => v >= w1.dps.groupMinMul)
      && groupMuls[3] >= 1.30 && groupMuls[4] >= 1.30,
    w13);

  // ---------- W14 总开关关闭零影响 ----------
  const w14 = await ev(`(function(){
    var d = window.__roamDebug.weapons;
    var before = d.info().stats.swings;
    var off = d.setEnabled(false);
    var chipOff = document.getElementById('weaponChip').style.display;
    var rowOff = document.getElementById('weaponModeRow').classList.contains('hidden');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    var during = d.info().stats.swings;
    var on = d.setEnabled(true);
    var chipOn = document.getElementById('weaponChip').style.display;
    var rowOn = document.getElementById('weaponModeRow').classList.contains('hidden');
    return {
      effectiveOff: off.effective, chipOff: chipOff, rowHiddenOff: rowOff,
      swingsBefore: before, swingsDuring: during,
      effectiveOn: on.effective, chipOn: chipOn, rowHiddenOn: rowOn
    };
  })()`);
  ok('W14 总开关：关闭后 Q 不增加挥击数、HUD 武器条与标题行隐藏；重开恢复',
    w14.effectiveOff === false && w14.chipOff === 'none' && w14.rowHiddenOff === true
      && w14.swingsDuring === w14.swingsBefore
      && w14.effectiveOn === true && w14.chipOn === '' && w14.rowHiddenOn === false, w14);

  // ---------- W15 存档往返 + 旧档缺字段 ----------
  const w15 = await ev(`(function(){
    var d = window.__roamDebug;
    d.weapons.set('spear', true);
    d.weapons.setMods({ edge: true, swift: true });
    state.weapon.combo = 0;
    state.weapon.comboTimer = 0;
    state.weapon.cd = 0;
    /* 显式写槽 1：不依赖 state.runSlot，避免自动存档占槽影响本项断言 */
    var save = saveRunSlot(1, 'manual');
    var savedData = d.p2.slotData(1);
    d.weapons.set('dagger', true);
    d.weapons.setMods({});
    var restored = d.p2.loadSlot(1);
    var info = d.weapons.info();
    var legacy = ensureWeaponState({ meta: { weaponId: 'hammer' } });
    return {
      saveResult: save,
      savedWeaponId: savedData && savedData.weapon ? savedData.weapon.id : null,
      restoredOk: !!restored && (restored.ok !== false),
      id: info.id,
      edge: info.mods.edge === true,
      swift: info.mods.swift === true,
      combo: info.combo,
      legacyId: legacy.weapon.id,
      legacyMods: Object.keys(legacy.weapon.mods).length,
      legacyStats: legacy.weapon.stats.swings
    };
  })()`);
  ok('W15 存档：武器+改造+连段往返一致；缺 weapon 字段的旧档补成 meta 指定武器',
    w15.id === 'spear' && w15.edge && w15.swift && w15.combo === 0
      && w15.legacyId === 'hammer' && w15.legacyMods === 0 && w15.legacyStats === 0, w15);

  // ---------- W16 截图 / fps / 错误 ----------
  await ev(`(function(){
    var d = window.__roamDebug;
    d.weapons.set('hammer', true);
    d.weapons.setMods({ edge: true, swift: true, reach: true, sunder: true });
    state.enemies = [];
    d.spawnEnemy('wanderer', 60, -18);
    d.spawnEnemy('wanderer', 64, 22);
    return d.weapons.swing({ angle: 0 });
  })()`);
  await sleep(60);
  await shot('weapons.png');
  const w16 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){ return { fps: f, errors: (window.__errors || []).length }; });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'weapons.png')).size; } catch (e) { shotSize = 0; }
  ok('W16 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && w16.fps >= 60 && w16.errors === 0, { shot: shotSize, w16 });

  // ---------- W17 视觉刃口 = 判定半径 / 贴边能中、隔空不掉血 ----------
  const w17 = await ev(`(function(){
    var d = window.__roamDebug;
    var geo = d.weapons.geometry({});
    var rows = [];
    geo.forEach(function(g){
      d.weapons.set(g.id, true);
      d.weapons.setMods({});
      state.enemies = [];
      state.weapon.cd = 0;
      state.weapon.combo = 0;
      state.weapon.comboTimer = 0;
      // 近点：敌人边缘已经贴住刃口（中心距 = 判定半径 + 敌人半径 − 2），必须命中
      d.spawnEnemy('wanderer', 0, 0);
      var near = state.enemies[0];
      near.hp = near.hpMax = 1000000;
      near.x = state.player.x + (g.reach + (near.radius || 16) - 2);
      near.y = state.player.y;
      var nearRes = d.weapons.swing({ probe: true, angle: 0 });
      // 远点：中心距 = 判定半径 + 敌人半径 + 20，必须 0 命中（不能隔空掉血）
      state.enemies = [];
      d.spawnEnemy('wanderer', 0, 0);
      var far = state.enemies[0];
      far.hp = far.hpMax = 1000000;
      far.x = state.player.x + (g.reach + (far.radius || 16) + 20);
      far.y = state.player.y;
      var farRes = d.weapons.swing({ probe: true, angle: 0 });
      rows.push({ id: g.id, nearHits: nearRes.hits, farHits: farRes.hits,
        reach: g.reach, tip: g.tip, gap: g.gap, aps: g.aps });
    });
    state.enemies = [];
    return rows;
  })()`);
  ok('W17 视觉刃口=判定半径（|差值|≤2px），贴边必中、外扩 20px 必空',
    w17.every((r) => Math.abs(r.gap) <= 2) && w17.every((r) => r.nearHits > 0)
      && w17.every((r) => r.farHits === 0), w17);

  // ---------- W18 每秒出手次数提升（改前基线写死，防止以后又被调慢） ----------
  const OLD_APS = { dagger: 2.94, longsword: 1.33, hammer: 0.88, twin: 2.94, spear: 1.61 };
  const w18 = w17.map((r) => ({
    id: r.id, old: OLD_APS[r.id], now: r.aps,
    gain: Number((r.aps / OLD_APS[r.id]).toFixed(2))
  }));
  ok('W18 每把武器每秒出手次数提升 ≥25%（去等待感）',
    w18.every((r) => r.gain >= 1.25), w18);

  // 收尾：把武器与开关恢复到可玩默认，避免影响串行脚本
  await ev(`(function(){
    window.__roamDebug.weapons.setEnabled(true);
    window.__roamDebug.weapons.set('dagger', true);
    window.__roamDebug.weapons.setMods({});
    return true;
  })()`);

  fs.writeFileSync(path.join(OUT_DIR, 'weapons-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== W weapons ${pass}/${asserts.length} ===== (shot ${shotSize}B, fps ${w16.fps})`);

  try { ws.close(); } catch (e) { /* ignore */ }
  try { killEdge(edge); } catch (e) { /* ignore */ }
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (pass !== asserts.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
