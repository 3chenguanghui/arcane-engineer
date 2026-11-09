/**
 * 第 27 项 · 词缀→分支路线取舍专项断言（端口 9584）
 * ------------------------------------------------------------
 * 证明"路线取舍"是真的，不是只改概率：
 *   R1 路线计划完整：8 条词缀都有 weights；有高收益标记的 4 条都带真实代价
 *      （extraCount > 0 或 hpTax > 0），重压/寒潮/死域不给"无风险高收益"标记
 *   R2 同种子换词缀 → 房型构成真的变了（淘金层精英数 > 死域层）
 *   R3 同种子 + 同词缀重复进入 → 房型 / 分数 / 标记完全一致（可预测）
 *   R4 **同种子换词缀 → 路线收益排序真的变了**（同一批 room id 的排序位置发生变化）
 *   R5 小地图：已探索的高收益房画出词缀色角标（数量与 routeTag 房数一致）
 *   R6 全屏地图：高收益房有标记，且统计数与 routeTag 房数一致
 *   R7 代价已真实生效：精英房每房多刷 extraCount 名敌人；守卫宝箱开箱扣 12% 生命
 *   R8 没有"高收益且无风险"：每个高收益房型都有代价，且分数仍高于同房型基础分
 *   R9 全流程无页面异常
 * 用法：node tools/arcane_routemods.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9584;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'routemods');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/** 本次启动的 Edge 进程（结束时连同子树一起结束） */
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
 * 主流程
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

  // 页面内实验台：同种子 / 强制词缀生成，读房型、分数、代价
  await ev(`(function(){
    window.__routeLab = {
      lcg: function(seed) { var s = seed >>> 0; return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; },
      gen: function(seed, floor, forceId) {
        FLOOR_MOD_CONFIG.enabled = true;
        FLOOR_MOD_CONFIG.forceId = forceId || null;
        /* 走真实种子局路径：seedActive() 为真时 generateFloor 会给
           "floor:层" 与 "spawn:层" 各建一条独立随机流，
           同种子同层重复进入的房型 / 敌人数量才会逐项一致。
           若用 __rngOverride 单流，前面的道具重试次数一变就会把后面数量带偏。 */
        __rngOverride = null;
        applySeedToState(seed, { custom: true });
        state.floor = floor;
        generateFloor(floor);
        return state.rooms.map(function(r){
          return { id: r.id, type: r.type, enemyCount: r.enemyCount || 0,
            routeExtra: r.routeExtra || 0, tag: r.routeTag ? r.routeTag.tag : null,
            score: roomRouteScore(r) };
        });
      },
      counts: function(rooms) {
        var c = {};
        rooms.forEach(function(r){ c[r.type] = (c[r.type] || 0) + 1; });
        return c;
      },
      order: function(rooms) {
        return rooms.slice().sort(function(a,b){ return (b.score - a.score) || (a.id - b.id); });
      },
      revealAll: function() {
        state.fog = state.fog || { seenRooms: {}, seenCorridors: {} };
        state.rooms.forEach(function(r){ state.fog.seenRooms[r.id] = true; });
        return true;
      }
    };
    return true;
  })()`);

  // ============================================================
  // R1：路线计划完整性（有收益必须有代价）
  // ============================================================
  const r1 = await ev(`(function(){
    var out = { missingWeights: [], valueCount: 0, badValue: [], noteEmpty: [], noValueMods: [] };
    FLOOR_MOD_CONFIG.pool.forEach(function(m){
      if (!m.route || !m.route.weights || !Object.keys(m.route.weights).length) out.missingWeights.push(m.id);
      if (!m.route || !m.route.note) out.noteEmpty.push(m.id);
      var keys = Object.keys((m.route && m.route.value) || {});
      if (!keys.length) { out.noValueMods.push(m.id); return; }
      keys.forEach(function(k){
        var v = m.route.value[k];
        out.valueCount += 1;
        if (!v.tag || !v.why || !(v.extraCount > 0 || v.hpTax > 0 || v.bonusCrystals > 0)) out.badValue.push(m.id + ':' + k);
        if (!(v.extraCount > 0 || v.hpTax > 0)) out.badValue.push('no-cost:' + m.id + ':' + k);
      });
    });
    return out;
  })()`);
  ok('R1 8 条词缀都有权重计划；5 条高收益房的每一个都带真实代价（更多敌人或血税）',
    r1.missingWeights.length === 0 && r1.noteEmpty.length === 0
      && r1.valueCount === 5 && r1.badValue.length === 0
      && r1.noValueMods.length === 3,
    r1);

  // ============================================================
  // R2 / R3：同种子换词缀 → 构成变化；同词缀重复 → 完全一致
  // ============================================================
  const SEED = 20261107;
  const FLOOR = 6;
  const gold = await ev(`window.__routeLab.gen(${SEED}, ${FLOOR}, 'goldRush')`);
  const gold2 = await ev(`window.__routeLab.gen(${SEED}, ${FLOOR}, 'goldRush')`);
  const death = await ev(`window.__routeLab.gen(${SEED}, ${FLOOR}, 'deathZone')`);
  const calm = await ev(`window.__routeLab.gen(${SEED}, ${FLOOR}, 'calmField')`);
  const goldCounts = await ev(`window.__routeLab.counts(${JSON.stringify(gold)})`);
  const deathCounts = await ev(`window.__routeLab.counts(${JSON.stringify(death)})`);

  const eliteGold = (goldCounts.elite || 0);
  const eliteDeath = (deathCounts.elite || 0);
  ok('R2 同种子换词缀：淘金层精英房显著多于死域层（权重真的进了生成结果）',
    eliteGold > eliteDeath && eliteGold >= 1,
    { seed: SEED, floor: FLOOR, eliteGold: eliteGold, eliteDeath: eliteDeath, goldCounts: goldCounts, deathCounts: deathCounts });

  const jsonGold = JSON.stringify(gold);
  const jsonGold2 = JSON.stringify(gold2);
  ok('R3 同种子 + 同词缀重复进入：房型 / 敌人数量 / 分数 / 标记完全一致（可预测）',
    jsonGold === jsonGold2, { identical: jsonGold === jsonGold2, rooms: gold.length,
      first: gold, second: gold2 });

  // ============================================================
  // R4：同种子换词缀 → 路线收益排序真的变了
  // ============================================================
  const orderGold = await ev(`window.__routeLab.order(${JSON.stringify(gold)}).map(function(r){ return r.id + ':' + r.type + '@' + r.score; })`);
  const orderDeath = await ev(`window.__routeLab.order(${JSON.stringify(death)}).map(function(r){ return r.id + ':' + r.type + '@' + r.score; })`);
  const orderCalm = await ev(`window.__routeLab.order(${JSON.stringify(calm)}).map(function(r){ return r.id + ':' + r.type + '@' + r.score; })`);
  let moved = 0;
  const len = Math.min(orderGold.length, orderDeath.length);
  for (let i = 0; i < len; i += 1) if (orderGold[i] !== orderDeath[i]) moved += 1;
  const topGold = orderGold[0] || '';
  const topDeath = orderDeath[0] || '';
  ok('R4 同种子换词缀：路线收益排序真的变了（同一批 room id 的位置发生移动，第一优先的分数也不同）',
    moved >= 2 && topGold !== topDeath,
    { movedPositions: moved, totalRooms: len, topGold: topGold, topDeath: topDeath,
      orderGold: orderGold, orderDeath: orderDeath, orderCalm: orderCalm });

  // ============================================================
  // R5 / R6：小地图 + 全屏地图标记
  // ============================================================
  const r5 = await ev(`(function(){
    window.__routeLab.gen(${SEED}, ${FLOOR}, 'goldRush');
    window.__routeLab.revealAll();
    drawMinimap();
    openPanel('map');
    var full = MAP_LAST_STATS ? MAP_LAST_STATS.highValueRooms : -1;
    var tagged = state.rooms.filter(function(r){ return !!r.routeTag; }).length;
    return { tagged: tagged, minimap: state.minimapStats.highValueRoomMarks,
      fullMap: full, modColor: state.floorMod.color,
      list: state.rooms.map(function(r){ return { id: r.id, type: r.type, tag: !!r.routeTag }; }) };
  })()`);
  /* 截图证据：全屏地图（面板仍开着）+ 小地图（关面板后重绘） */
  const shotFull = await shot('route-fullmap.png');
  await ev(`closePanel('map'); drawMinimap(); true`);
  const shotMini = await shot('route-minimap.png');
  ok('R5/R6 小地图与全屏地图都画出高收益标记，数量与 routeTag 房数一致',
    r5.tagged >= 1 && r5.minimap === r5.tagged && r5.fullMap === r5.tagged,
    Object.assign({}, r5, { shotFull: shotFull, shotMini: shotMini }));

  // ============================================================
  // R7：代价真实生效（精英 +1 敌人 / 宝箱扣 12% 生命）
  // ============================================================
  const r7 = await ev(`(function(){
    // 7a 精英房：同种子淘金层下，每间精英房都真的多刷了 1 名敌人
    window.__routeLab.gen(${SEED}, ${FLOOR}, 'goldRush');
    var eliteRooms = state.rooms.filter(function(r){ return r.type === 'elite' && r.routeTag; });
    var extraSum = eliteRooms.reduce(function(s,r){ return s + (r.routeExtra || 0); }, 0);
    var allExtra = eliteRooms.length > 0 && eliteRooms.every(function(r){ return r.routeExtra === 1 && r.enemyCount > 0; });

    // 7b 守卫宝箱 vs 普通宝箱：同一次开箱对照（血税 vs 无税，结晶多 vs 少）
    var p = state.player;
    var hpMax = p.hpMax;
    function openChest(modId) {
      FLOOR_MOD_CONFIG.forceId = modId || null;
      state.floorMod = modId
        ? FLOOR_MOD_CONFIG.pool.find(function(m){ return m.id === modId; })
        : null;
      p.hp = hpMax;
      state.meta.crystals = 0;
      state.crystalRunGain = 0;
      state.crystalExtraSpent = 0;
      var before = p.hp;
      applyRoomReward({ id: 999, type: 'chest', cx: 500, cy: 400, cleared: true, rewarded: false });
      return { crystals: state.meta.crystals, hpLoss: before - p.hp };
    }
    var plain = openChest(null);
    var guarded = openChest('richVein');
    var expectTax = Math.max(1, Math.round(hpMax * 0.12));
    return { eliteRooms: eliteRooms.length, extraSum: extraSum, allExtra: allExtra,
      hpMax: hpMax, plain: plain, guarded: guarded, expectTax: expectTax };
  })()`);
  ok('R7 代价真实生效：淘金精英房每房 +1 敌人；守卫宝箱比普通宝箱多给结晶，但开箱扣 12% 最大生命',
    r7.allExtra === true && r7.extraSum === r7.eliteRooms
      && r7.guarded.hpLoss === r7.expectTax && r7.plain.hpLoss === 0
      && r7.guarded.crystals > r7.plain.crystals,
    r7);

  // ============================================================
  // R8：不存在"高收益且无风险"的房
  // ============================================================
  const r8 = await ev(`(function(){
    var out = [];
    FLOOR_MOD_CONFIG.pool.forEach(function(m){
      var keys = Object.keys((m.route && m.route.value) || {});
      keys.forEach(function(k){
        var v = m.route.value[k];
        var cost = (v.extraCount || 0) * 0.2 + (v.hpTax || 0);
        // 临时挂该词缀算分数
        var prev = state.floorMod;
        state.floorMod = m;
        var score = roomRouteScore({ type: k });
        state.floorMod = prev;
        var base = FLOOR_ROUTE_BASE[k] || 0;
        out.push({ mod: m.id, type: k, base: base, score: score, cost: cost,
          hasCost: cost > 0, stillBetter: score > base });
      });
    });
    return { rows: out, allCost: out.every(function(o){ return o.hasCost; }),
      allBetter: out.every(function(o){ return o.stillBetter; }) };
  })()`);
  ok('R8 每个高收益房型都有代价，且净收益仍高于基础房型（高风险高回报，不是纯白给）',
    r8.rows.length === 5 && r8.allCost && r8.allBetter, r8);

  const pageErrors = await ev(`window.__errors.slice()`);
  ok('R9 全流程无页面异常', pageErrors.length === 0, { errors: pageErrors });

  // 收尾：恢复钩子，避免影响后续同页断言
  await ev(`FLOOR_MOD_CONFIG.forceId = null; true`);

  const bytes = await shot('route-marker.png');

  const result = { port: PORT, asserts, pageErrors, screenshotBytes: bytes,
    verdict: asserts.every((a) => a.pass) ? 'PASS' : 'FAIL' };
  fs.writeFileSync(path.join(__dirname, 'arcane_routemods-result.json'), JSON.stringify(result, null, 2));
  console.log('VERDICT: ' + result.verdict + ' (' + asserts.filter((a) => a.pass).length + '/' + asserts.length + ')');
  ws.close();
  killEdge(edgeProc);
  if (result.verdict !== 'PASS') process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e); killEdge(edgeProc); process.exitCode = 1; });
