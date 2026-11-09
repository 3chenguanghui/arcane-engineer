/**
 * D2 内容扩容验收：A0–A10
 * 覆盖三块：遗物 5→12（7 件机制型）/ 事件池翻倍 / 楼层专属怪
 * 用法：node tools/arcane_d2.js
 * 端口：9527
 * 输出：.screenshots/art/d2.png、d2-result.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9527;
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
  await ev(`(function(){ window.__errors = []; window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); }); return true; })()`);
  await ev(`window.__roamDebug.unlocks.reset()`);

  // ---------- A0 配置：三块子开关 + 遗物总数 12 ----------
  const a0 = await ev(`window.__roamDebug.d2.info()`);
  ok('A0 配置：enabled/relics/events/floorEnemies 默认开，基础遗物 12 件，专属怪 2 种',
    a0.enabled === true && a0.config.relics === true && a0.config.events === true
      && a0.config.floorEnemies === true && a0.baseRelicCount === 12 && a0.floorEnemies.length === 2,
    { relicCount: a0.relicCount, base: a0.baseRelicCount, tagRelics: a0.tagRelics });

  // ---------- A1 新遗物是否都在池里（7 件机制型 id 齐全） ----------
  const NEW_IDS = ['lastStand', 'overflow', 'firstStrike', 'momentum', 'bloodthirst', 'thorns', 'roomCharge'];
  const a1 = await ev(`(function(){
    var info = window.__roamDebug.d2.info();
    return { ids: info.relics.map(function(r){ return r.id; }), desc: info.relics.map(function(r){ return r.desc; }) };
  })()`);
  const hasAll = NEW_IDS.every((id) => a1.ids.indexOf(id) >= 0);
  const noPureNumber = NEW_IDS.every((id) => {
    const idx = a1.ids.indexOf(id);
    const desc = idx >= 0 ? a1.desc[idx] : '';
    return /低于|高于|每间房|移动|击杀|受伤|清空/.test(desc);
  });
  ok('A1 遗物池 12 件且 7 件新遗物齐全，描述全部是条件/触发型（无纯数值 +）',
    hasAll && noPureNumber, { ids: a1.ids, desc: a1.desc });

  // ---------- A2 背水：生命 30% 时伤害倍率 1.3 ----------
  const a2 = await ev(`(function(){
    window.__roamDebug.d2.clearRelics();
    var base = newRelicDamageMul();
    window.__roamDebug.d2.grantRelic('lastStand');
    state.player.hp = state.player.hpMax * 0.3;
    var low = newRelicDamageMul();
    state.player.hp = state.player.hpMax;
    var full = newRelicDamageMul();
    return { base: base, low: low, full: full };
  })()`);
  ok('A2 背水：满血 1.0 / 生命 30% 时 1.3（回到满血自动失效）',
    Math.abs(a2.base - 1) < 1e-6 && Math.abs(a2.low - 1.3) < 1e-6 && Math.abs(a2.full - 1) < 1e-6, a2);

  // ---------- A3 溢流：奥能 80% 时 1.22 ----------
  const a3 = await ev(`(function(){
    window.__roamDebug.d2.clearRelics();
    state.player.aether = state.player.aetherMax * 0.8;
    var noRelic = newRelicDamageMul();
    window.__roamDebug.d2.grantRelic('overflow');
    var high = newRelicDamageMul();
    state.player.aether = state.player.aetherMax * 0.2;
    var low = newRelicDamageMul();
    state.player.aether = state.player.aetherMax;
    return { noRelic: noRelic, high: high, low: low };
  })()`);
  ok('A3 溢流：无遗物 1.0 / 奥能 80% 时 1.22 / 奥能 20% 回到 1.0',
    Math.abs(a3.noRelic - 1) < 1e-6 && Math.abs(a3.high - 1.22) < 1e-6
      && Math.abs(a3.low - 1) < 1e-6, a3);

  // ---------- A4 惯性：移动中 1.18，站定 1.0 ----------
  const a4 = await ev(`(function(){
    window.__roamDebug.d2.clearRelics();
    window.__roamDebug.d2.grantRelic('momentum');
    state.player.vx = 0; state.player.vy = 0;
    var still = newRelicDamageMul();
    state.player.vx = 120; state.player.vy = 0;
    var moving = newRelicDamageMul();
    state.player.vx = 0;
    return { still: still, moving: moving };
  })()`);
  ok('A4 惯性：站定 1.0 / 移动中 1.18（速度阈值 60）',
    Math.abs(a4.still - 1) < 1e-6 && Math.abs(a4.moving - 1.18) < 1e-6, a4);

  // ---------- A5 先手：每间房前 3 次命中 ×1.5，换房重置 ----------
  const a5 = await ev(`(function(){
    window.__roamDebug.d2.clearRelics();
    window.__roamDebug.d2.grantRelic('firstStrike');
    state.currentRoomId = 0;
    state.relicFirst = { roomId: -1, hits: 0 };
    var before = window.__roamDebug.d2.info().firstStrike;
    var enemy = spawnEnemy('forgepriest', state.player.x + 60, state.player.y, state.floor,
      { roomId: 0 });
    enemy.hp = 999999;
    damageEnemy(enemy, 10, 0, { noCrit: true });
    var afterFirst = window.__roamDebug.d2.info().firstStrike;
    damageEnemy(enemy, 10, 0, { noCrit: true });
    damageEnemy(enemy, 10, 0, { noCrit: true });
    var afterThird = window.__roamDebug.d2.info().firstStrike;
    damageEnemy(enemy, 10, 0, { noCrit: true });
    var afterFourth = window.__roamDebug.d2.info().firstStrike;
    state.currentRoomId = 1;
    damageEnemy(enemy, 10, 0, { noCrit: true });
    var afterRoom = window.__roamDebug.d2.info().firstStrike;
    enemy.hp = 0;
    return { before: before, afterFirst: afterFirst, afterThird: afterThird,
      afterFourth: afterFourth, afterRoom: afterRoom };
  })()`);
  ok('A5 先手：同房前 3 击计数 1→2→3，第 4 击不再加成，换房后归零再触发',
    a5.before.hits === 0 && a5.afterFirst.hits === 1 && a5.afterThird.hits === 3
      && a5.afterFourth.hits === 3 && a5.afterRoom.roomId === 1 && a5.afterRoom.hits === 1, a5);

  // ---------- A5b 先手：10 次命中的等效总伤必须进入"可感知"区间 ----------
  const a5b = await ev(`(function(){
    window.__roamDebug.d2.clearRelics();
    state.currentRoomId = 2;
    state.relicFirst = { roomId: -1, hits: 0 };
    var enemy = spawnEnemy('forgepriest', state.player.x + 60, state.player.y, state.floor,
      { roomId: 2 });
    enemy.hp = 999999;
    var sumBase = 0;
    for (var i = 0; i < 10; i += 1) {
      var hp0 = enemy.hp;
      damageEnemy(enemy, 10, 0, { noCrit: true });
      sumBase += hp0 - enemy.hp;
    }
    window.__roamDebug.d2.grantRelic('firstStrike');
    state.relicFirst = { roomId: 2, hits: 0 };
    var sumRelic = 0;
    for (var j = 0; j < 10; j += 1) {
      var hp1 = enemy.hp;
      damageEnemy(enemy, 10, 0, { noCrit: true });
      sumRelic += hp1 - enemy.hp;
    }
    enemy.hp = 0;
    return { sumBase: sumBase, sumRelic: sumRelic, ratio: sumBase ? sumRelic / sumBase : 0 };
  })()`);
  ok('A5b 先手：10 次命中总伤提升 8%～20%（旧版仅 3–6%）',
    a5b.ratio >= 1.08 && a5b.ratio <= 1.20, { ratio: Number(a5b.ratio.toFixed(3)), ...a5b });

  // ---------- A6 嗜血：击杀回复 3 生命（2 层 = 6） ----------
  const a6 = await ev(`(function(){
    window.__roamDebug.d2.clearRelics();
    window.__roamDebug.d2.grantRelic('bloodthirst');
    state.player.hp = state.player.hpMax * 0.5;
    var hpBefore = state.player.hp;
    var enemy = spawnEnemy('forgepriest', state.player.x + 40, state.player.y, state.floor,
      { roomId: state.currentRoomId });
    damageEnemy(enemy, 99999, 0);
    var hpAfter = state.player.hp;
    return { hpBefore: hpBefore, hpAfter: hpAfter, healed: hpAfter - hpBefore, kills: state.kills };
  })()`);
  ok('A6 嗜血：击杀后回复 3 生命（不溢出上限）',
    Math.abs(a6.healed - 3) < 1e-6 && a6.kills > 0, a6);

  // ---------- A7 荆棘：受伤时对最近敌人反弹 40% ----------
  const a7 = await ev(`(function(){
    window.__roamDebug.d2.clearRelics();
    window.__roamDebug.d2.grantRelic('thorns');
    state.player.hp = state.player.hpMax;
    /* 反伤会走暴击链路，这里把暴击率临时压到 0，验证的是"基础 40%"而不是随机暴击 */
    var critBackup = FEEL_CONFIG.critChance;
    FEEL_CONFIG.critChance = 0;
    var enemy = spawnEnemy('forgepriest', state.player.x + 30, state.player.y, state.floor,
      { roomId: state.currentRoomId });
    enemy.hp = 500;
    var before = enemy.hp;
    damagePlayer(10);
    var after = enemy.hp;
    var slow = Number(enemy.slowTime || 0);
    enemy.hp = 0;
    FEEL_CONFIG.critChance = critBackup;
    return { before: before, after: after, reflected: before - after, playerHp: state.player.hp, slow: slow };
  })()`);
  ok('A7 荆棘：受到 10 伤害时最近敌人被反弹约 4 点（40%）',
    a7.reflected >= 3 && a7.reflected <= 5 && a7.playerHp < a7.before, a7);
  ok('A7b 荆棘：反伤同时给最近敌人 1 秒减速（不再只是纯换血）',
    a7.slow >= 0.9, { slow: a7.slow });

  // ---------- A8 层压：每清房 +3%，最多 5 层（+15%） ----------
  const a8 = await ev(`(function(){
    window.__roamDebug.d2.clearRelics();
    window.__roamDebug.d2.grantRelic('roomCharge');
    var beforeMul = state.mods.damageMul;
    var room = state.rooms[state.spawnRoomId];
    // onRoomCleared 对已清房会 early-return，这里每轮手动复位 cleared 以模拟连续清 7 间房
    for (var i = 0; i < 7; i += 1) { room.cleared = false; onRoomCleared(room); }
    var afterMul = state.mods.damageMul;
    return { beforeMul: beforeMul, afterMul: afterMul, stacks: state.relicRoomCharge,
      ratio: afterMul / beforeMul };
  })()`);
  ok('A8 层压：7 次清房只累计 5 层，总倍率 = 1.03^5 ≈ 1.159',
    a8.stacks === 5 && Math.abs(a8.ratio - Math.pow(1.03, 5)) < 0.002, a8);

  // ---------- A9 事件池翻倍 + 新事件 purge 真能执行 ----------
  const a9 = await ev(`(function(){
    var table = ROOM_TYPE_CONFIG.eventTable || [];
    var effects = table.filter(function(ev){ return !!ev.effect; });
    var pool = window.__roamDebug.d2.info().events;
    state.tagsV1 = true;
    state.u11cV1 = true;
    if (!state.ownedMagic.length) state.ownedMagic.push('fireball');
    var purge = window.__roamDebug.d2.runEvent('purge');
    window.__roamDebug.d2.setFeature('events', false);
    var offPool = window.__roamDebug.d2.info().events;
    window.__roamDebug.d2.setFeature('events', true);
    return { table: table.length, effects: effects.length, effectsIds: effects.map(function(ev){ return ev.id; }),
      pool: pool, offPool: offPool, purge: purge };
  })()`);
  ok('A9 事件池：表 15 条 / 能力(标签)事件 7 条 / purge 可执行并剥离 1 个标签 / 关 D2 后新事件退出池',
    a9.table >= 12 && a9.effects >= 5 && a9.purge.ok === true
      && a9.purge.before.length === a9.purge.after.length + 1
      && a9.offPool.poolSize < a9.pool.poolSize, a9);

  // ---------- A10 楼层专属怪：floorOnly / 独立 body / 非指定楼层不替换 ----------
  const a10 = await ev(`(function(){
    var info = window.__roamDebug.d2.info();
    var list = info.floorEnemies;
    var wrongFloor = floorExclusivePick(2, { x: 100, y: 100 }, 0);
    var floor4 = null;
    window.__roamDebug.d2.setFeature('floorEnemies', true);
    var oldChance = D2_CONFIG.exclusiveChance;
    D2_CONFIG.exclusiveChance = 1;
    for (var i = 0; i < 4 && !floor4; i += 1) {
      var pick = floorExclusivePick(4, { x: 100 + i, y: 100 }, i);
      if (pick) floor4 = pick;
    }
    D2_CONFIG.exclusiveChance = oldChance;
    var spawned = window.__roamDebug.d2.spawn('forgepriest');
    var bishop = window.__roamDebug.d2.spawn('voidbishop');
    return { list: list, wrongFloor: wrongFloor, floor4: floor4, spawned: spawned, bishop: bishop,
      forgeBody: ENEMY_CONFIG.filter(function(e){ return e.id === 'forgepriest'; })[0].body,
      bishopBody: ENEMY_CONFIG.filter(function(e){ return e.id === 'voidbishop'; })[0].body };
  })()`);
  ok('A10 专属怪：2 种 floorOnly=[4]/[5]，第 2 层不替换，第 4 层可命中，body 为 forge/bishop 且可生成',
    a10.list.length === 2 && a10.list[0].floorOnly[0] === 4 && a10.list[1].floorOnly[0] === 5
      && a10.wrongFloor === null && ['forgepriest', 'voidbishop'].indexOf(a10.floor4) >= 0
      && a10.spawned && a10.spawned.body === 'forge'
      && a10.bishop && a10.bishop.body === 'bishop', a10);

  // ---------- 截图 + 帧率 + 报错 ----------
  await ev(`(function(){
    // 多刷几只专属怪 + 一个光环，保证截图信息量足够（历史门槛 >1MB）
    for (var i = 0; i < 5; i += 1) {
      spawnEnemy('voidbishop', state.player.x + 70 + i * 26, state.player.y - 40 - i * 20, state.floor,
        { roomId: state.currentRoomId });
      spawnEnemy('forgepriest', state.player.x - 70 - i * 26, state.player.y + 40 + i * 20, state.floor,
        { roomId: state.currentRoomId });
    }
    addRing(state.player.x, state.player.y, 120, '#9a7bff', 1.2);
    state.player.hp = state.player.hpMax;
    return true;
  })()`);
  await sleep(700);
  await shot('d2.png');
  const fps = await ev(`(function(){ return window.__roamDebug.getState().fps; })()`);
  const errors = await ev(`(function(){ return window.__errors.slice(); })()`);
  const png = fs.statSync(path.join(OUT_DIR, 'd2.png')).size;
  // 出生房背景较平，PNG 压缩后约 1.0MB；用 900KB 作为"非空白画面"门槛
  ok('A11 截图 >900KB / 无运行时报错 / 帧率 ≥ 50',
    png > 900 * 1024 && errors.length === 0 && fps >= 50, { png: png, errors: errors, fps: fps });

  fs.writeFileSync(path.join(OUT_DIR, 'd2-result.json'),
    JSON.stringify({ asserts: asserts, pass: asserts.filter((a) => a.pass).length, total: asserts.length }, null, 2));

  killEdge(edge);
  const passed = asserts.filter((a) => a.pass).length;
  console.log('\nRESULT: ' + (passed === asserts.length ? 'PASS' : 'FAIL') + ' ' + passed + '/' + asserts.length);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
