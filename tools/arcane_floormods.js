/**
 * 第 26 项 · 层随机词缀专项断言（端口 9583）
 * ------------------------------------------------------------
 * 验证七件事：
 *   F1 词缀池条目数与类别分布（8 条：2 good / 2 bad / 3 gamble / 1 avoid，权重和 = 1）
 *   F2 每条词缀字段完整（id / name / glyph / desc / color / kind），id 唯一
 *   F3 结构承诺：赌注类必须"同时有正有负"，回避类必须是"纯该绕开"，好坏两类不掺假补偿
 *   F4 抽取可复现：同一随机序列 → 同一条
 *   F5 权重抽样：2000 次抽样四类都出现，占比与配置权重相差 ≤6 个百分点
 *   F6 层闸门：第 1 层无词缀；第 2 层起有词缀；同种子同层重生成结果一致
 *   F7 UI 三处同源：左侧 HUD 芯片 / 全屏地图顶栏 / 小地图角标文本一致，且 HUD 在视口内
 *   F8 效果实测：结晶 1.4×、敌人移速 1.18×、敌人伤害 1.25×（白名单 cause），
 *      死域层 floorHealAmount 归零
 * 用法：node tools/arcane_floormods.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9583;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'floormods');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/** 本次启动的 Edge 进程（脚本结束/报错都要连同子树一起结束，避免残留占端口与 profile） */
let edgeProc = null;
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * 主流程：无头 Edge → 逐项采集证据 → 写 result.json
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  edgeProc = spawn(EDGE, [
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
    return fs.statSync(path.join(OUT_DIR, name)).size;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){
    window.__errors = [];
    window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); });
    window.addEventListener('unhandledrejection', function(e){ window.__errors.push('rej:' + e.reason); });
    document.querySelector('#btnStart').click();
    return true;
  })()`);
  await sleep(1200);

  // ============================================================
  // F1：池子条目数与类别分布
  // ============================================================
  const f1 = await ev(`(function(){
    var d = floorModDistribution();
    var w = FLOOR_MOD_CONFIG.weights;
    var sum = w.good + w.bad + w.gamble + w.avoid;
    return { total: d.total, byKind: d.byKind, weightSum: Math.round(sum * 1000) / 1000,
      enabled: FLOOR_MOD_CONFIG.enabled, firstModFloor: FLOOR_MOD_CONFIG.firstModFloor,
      weights: { good: w.good, bad: w.bad, gamble: w.gamble, avoid: w.avoid } };
  })()`);
  ok('F1 池 8 条、分布 2 good / 2 bad / 3 gamble / 1 avoid、权重和 = 1',
    f1.total === 8
      && f1.byKind.good.count === 2 && f1.byKind.bad.count === 2
      && f1.byKind.gamble.count === 3 && f1.byKind.avoid.count === 1
      && f1.weightSum === 1 && f1.enabled === true && f1.firstModFloor === 2,
    f1);

  // ============================================================
  // F2：字段完整 + id 唯一
  // ============================================================
  const f2 = await ev(`(function(){
    var pool = FLOOR_MOD_CONFIG.pool;
    var ids = pool.map(function(m){ return m.id; });
    var bad = [];
    pool.forEach(function(m){
      if (!m.id || !m.name || !m.glyph || !m.desc || !m.color || !m.kind) bad.push(m.id || '?');
      if (!/^#([0-9a-fA-F]{6})$/.test(m.color)) bad.push('color:' + m.id);
      if (!m.mul || typeof m.mul !== 'object') bad.push('mul:' + m.id);
    });
    return { bad: bad, unique: ids.filter(function(v,i){ return ids.indexOf(v) === i; }).length, total: pool.length };
  })()`);
  ok('F2 每条字段完整、颜色为 #RRGGBB、id 唯一',
    f2.bad.length === 0 && f2.unique === f2.total, f2);

  // ============================================================
  // F3：池子结构承诺（赌 / 绕 / 好 / 坏 不掺假）
  // ============================================================
  const f3 = await ev(`(function(){
    function harmful(m){
      var x = m.mul || {};
      return (x.enemySpeed || 1) > 1.0001 || (x.enemyDamage || 1) > 1.0001 || (x.heal == null ? 1 : x.heal) < 0.9999;
    }
    function beneficial(m){
      var x = m.mul || {};
      return (x.crystal || 1) > 1.0001 || (x.aether || 1) > 1.0001
        || (x.heal == null ? 1 : x.heal) > 1.0001 || (x.enemySpeed == null ? 1 : x.enemySpeed) < 0.9999;
    }
    var out = [];
    FLOOR_MOD_CONFIG.pool.forEach(function(m){
      out.push({ id: m.id, kind: m.kind, harmful: harmful(m), beneficial: beneficial(m), mul: m.mul });
    });
    var bad = out.filter(function(o){
      if (o.kind === 'good') return !(o.beneficial && !o.harmful);
      if (o.kind === 'bad') return !(o.harmful && !o.beneficial);
      if (o.kind === 'gamble') return !(o.beneficial && o.harmful);
      if (o.kind === 'avoid') return !(o.harmful && !o.beneficial);
      return true;
    });
    var avoid = out.find(function(o){ return o.kind === 'avoid'; });
    var g = out.filter(function(o){ return o.kind === 'gamble'; });
    return { out: out, bad: bad.map(function(o){ return o.id; }),
      avoidHealZero: !!(avoid && avoid.mul && avoid.mul.heal === 0),
      gambleAllTwoSided: g.length === 3 && g.every(function(o){ return o.beneficial && o.harmful; }) };
  })()`);
  ok('F3 赌注 3 条全部"有正有负"、回避 1 条纯负面且治疗归零、好坏两类无掺假补偿',
    f3.bad.length === 0 && f3.avoidHealZero && f3.gambleAllTwoSided, f3);

  // ============================================================
  // F4：抽取可复现（同一随机序列 → 同一条）
  // ============================================================
  const f4 = await ev(`(function(){
    function seq(vals){ var i = 0; return function(){ return vals[i++ % vals.length]; }; }
    var a1 = pickFloorMod(seq([0.10, 0.30]));
    var a2 = pickFloorMod(seq([0.10, 0.30]));
    var b1 = pickFloorMod(seq([0.75, 0.80]));
    var b2 = pickFloorMod(seq([0.75, 0.80]));
    return { a1: a1 && a1.id, a2: a2 && a2.id, b1: b1 && b1.id, b2: b2 && b2.id };
  })()`);
  ok('F4 同一随机序列抽到同一条词缀',
    f4.a1 && f4.a1 === f4.a2 && f4.b1 && f4.b1 === f4.b2, f4);

  // ============================================================
  // F5：权重抽样（2000 次，四类都出现且占比贴近配置）
  // ============================================================
  const f5 = await ev(`(function(){
    var s = 20261107 >>> 0;
    function lcg(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
    var counts = { good: 0, bad: 0, gamble: 0, avoid: 0 };
    var N = 2000;
    for (var i = 0; i < N; i += 1) {
      var m = pickFloorMod(lcg);
      if (m) counts[m.kind] += 1;
    }
    var shares = {};
    ['good','bad','gamble','avoid'].forEach(function(k){ shares[k] = Math.round((counts[k] / N) * 1000) / 1000; });
    return { counts: counts, shares: shares, weights: FLOOR_MOD_CONFIG.weights, N: N };
  })()`);
  const f5diff = ['good', 'bad', 'gamble', 'avoid'].map((k) => Math.abs(f5.shares[k] - f5.weights[k]));
  ok('F5 2000 次抽样四类都出现，占比与配置权重相差 ≤6 个百分点',
    f5.counts.good > 0 && f5.counts.bad > 0 && f5.counts.gamble > 0 && f5.counts.avoid > 0
      && Math.max.apply(null, f5diff) <= 0.06,
    f5);

  // ============================================================
  // F6：层闸门 + 同种子同层可复现
  // ============================================================
  const f6 = await ev(`(function(){
    function lcg(seed){ var s = seed >>> 0; return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
    var prevSeed = state.seedInfo;
    state.seedInfo = { active: false, value: 0 };
    // 第 1 层：教学层，不挂词缀
    state.floor = 1; __rngOverride = lcg(7);
    generateFloor(1);
    var f1 = state.floorMod ? state.floorMod.id : null;
    // 第 2 层：同种子两次
    state.floor = 2; __rngOverride = lcg(7);
    generateFloor(2);
    var a = state.floorMod ? state.floorMod.id : null;
    state.floor = 2; __rngOverride = lcg(7);
    generateFloor(2);
    var b = state.floorMod ? state.floorMod.id : null;
    __rngOverride = null;
    state.seedInfo = prevSeed;
    return { floor1: f1, a: a, b: b };
  })()`);
  ok('F6 第 1 层无词缀、第 2 层起有词缀、同种子同层重生成一致',
    f6.floor1 === null && f6.a && f6.a === f6.b, f6);

  // ============================================================
  // F7：HUD / 全屏地图 / 小地图 三处同源
  // ============================================================
  const f7 = await ev(`(function(){
    state.floor = 2;
    updateHUD();
    var el = document.getElementById('hudFloorMod');
    var r = el.getBoundingClientRect();
    var mod = state.floorMod;
    var out = {
      hud: el.textContent, className: el.className, title: el.title,
      modId: mod && mod.id, kind: mod && mod.kind, desc: mod && mod.desc,
      inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
    };
    openPanel('map');
    var mp = document.getElementById('mapModText');
    out.mapText = mp.textContent; out.mapClass = mp.className; out.mapTitle = mp.title;
    closePanel('map');
    drawMinimap();
    out.minimap = state.minimapStats ? state.minimapStats.floorModText : null;
    return out;
  })()`);
  const f7same = f7.hud === f7.mapText && f7.hud === f7.minimap;
  ok('F7 HUD / 全屏地图 / 小地图同源同文本，且 HUD 芯片在视口内',
    f7same && f7.inViewport
      && f7.className.indexOf('mod-' + f7.kind) >= 0
      && f7.mapClass.indexOf('mod-' + f7.kind) >= 0
      && f7.title.indexOf(f7.desc) >= 0,
    f7);

  // ============================================================
  // F8：效果实测（结晶 / 移速 / 敌人伤害 / 治疗归零）
  // ============================================================
  const f8 = await ev(`(function(){
    var out = {};
    // 8a 倍率读取
    state.floorMod = { mul: { crystal: 1.4, enemySpeed: 1.18, enemyDamage: 1.25, heal: 0, aether: 1.35 } };
    out.crystalMul = floorModMul('crystal');
    out.speedMul = floorModMul('enemySpeed');
    out.dmgMul = floorModMul('enemyDamage');
    out.aetherMul = floorModMul('aether');
    out.heal100 = floorHealAmount(100);
    out.none = (function(){ var m = state.floorMod; state.floorMod = null; var v = [floorModMul('crystal'), floorHealAmount(100)]; state.floorMod = m; return v; })();

    // 8b 结晶实测：同一笔 10 结晶，富矿 ×1.4
    function grant(mul){
      state.floorMod = mul ? { mul: { crystal: mul } } : null;
      state.meta.crystals = 0; state.crystalRunGain = 0; state.crystalExtraSpent = 0;
      return grantRunCrystals(10, 'testFloorMod');
    }
    var g1 = grant(1.4), g2 = grant(null);
    out.crystalGain = { with: g1, base: g2 };

    // 8c 移速实测：同一种怪、同一层，淘金层 ×1.18
    state.enemies.length = 0;
    state.floorMod = { mul: { enemySpeed: 1.18 } };
    var e1 = spawnEnemy('chanter', 900, 600, 3, {});
    var s1 = e1.speed;
    state.enemies.length = 0;
    state.floorMod = null;
    var e2 = spawnEnemy('chanter', 900, 600, 3, {});
    var s2 = e2.speed;
    out.speedRatio = s2 ? Math.round((s1 / s2) * 1000) / 1000 : 0;

    // 8d 敌人伤害实测：同一发 40 点 contact，狂暴层 ×1.25
    var p = state.player;
    var saved = { hp: p.hp, invuln: p.invuln, shield: p.shield, mode: state.mode, status: state.status };
    state.mode = 'playing'; state.status = 'playing';
    function hitLoss(mul){
      state.floorMod = mul ? { mul: { enemyDamage: mul } } : null;
      p.hp = 1000; p.invuln = 0; p.shield = 0;
      var before = p.hp;
      damagePlayer(40, p.x + 1000, p.y, { kind: 'contact' });
      return before - p.hp;
    }
    var d1 = hitLoss(null), d2 = hitLoss(1.25);
    out.dmgLoss = { base: d1, with: d2, ratio: d1 ? Math.round((d2 / d1) * 1000) / 1000 : 0 };
    p.hp = saved.hp; p.invuln = saved.invuln; p.shield = saved.shield;
    state.mode = saved.mode; state.status = saved.status;

    state.enemies.length = 0;
    state.floorMod = null;
    return out;
  })()`);
  ok('F8 效果实测：结晶 1.4×、移速 1.18×、敌人伤害 1.25×、死域治疗归零',
    f8.crystalMul === 1.4 && f8.speedMul === 1.18 && f8.dmgMul === 1.25 && f8.aetherMul === 1.35
      && f8.heal100 === 0 && f8.none[0] === 1 && f8.none[1] === 100
      && f8.crystalGain.with === 14 && f8.crystalGain.base === 10
      && Math.abs(f8.speedRatio - 1.18) < 0.03
      && f8.dmgLoss.with > f8.dmgLoss.base
      && f8.dmgLoss.ratio >= 1.15 && f8.dmgLoss.ratio <= 1.35,
    f8);

  const pageErrors = await ev(`window.__errors.slice()`);
  ok('F9 全流程无页面异常', pageErrors.length === 0, { errors: pageErrors });

  const bytes = await shot('floormod-hud.png');

  const result = { port: PORT, asserts, pageErrors, screenshotBytes: bytes,
    verdict: asserts.every((a) => a.pass) ? 'PASS' : 'FAIL' };
  fs.writeFileSync(path.join(__dirname, 'arcane_floormods-result.json'), JSON.stringify(result, null, 2));
  console.log('VERDICT: ' + result.verdict + ' (' + asserts.filter((a) => a.pass).length + '/' + asserts.length + ')');
  ws.close();
  killEdge(edgeProc);
  if (result.verdict !== 'PASS') process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e); killEdge(edgeProc); process.exitCode = 1; });
