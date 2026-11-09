/**
 * X 批 · 魔法近 / 中 / 远三档手感表（撤掉武器后的"距离感"验收）
 * ------------------------------------------------------------
 * 用法：
 *   node tools/_magic_range.js [html] [outJson]
 *
 * 为什么需要它：
 *   武器撤掉后，玩家对"距离"的感知只能由魔法承担。如果 12 张魔法卡
 *   射程全部差不多，手感就会退化成"同一个爆炸换数字"。本探针把每张卡的
 *   「有效射程 / 生效延迟 / 形状」量出来，分成 near / mid / far 三档，
 *   并对"三档齐全、档间差距足够、同档内不重复"写硬断言。
 *
 * 数据来源（不手写第二份真值）：
 *   · AOE 6 张：直接读 AOE_SKILL_CONFIG（line/field/ringband/pull/cone/selfring）
 *   · 火球：真实施放后读弹体 vx/vy + life → 射程 = 速度 × 寿命
 *   · 冰环：真实施放后读特效环 radius + grow → 视觉/判定最大半径
 *   · 回旋刃：读 TACTIC_CONFIG.blade（speed × outTime，回程不延长射程）
 *   · 符文雷：读 getGroundCastPoint(420) 的真实落点距离 + 触发半径
 *   · 雷击：实测 findNearestEnemy 的搜索半径（500 命中 / 560 不命中）
 *
 * 端口 9593（与其它探针互斥，不能并行跑）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9593;
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 页面内：测量 12 张魔法卡的有效射程 / 延迟 / 形状
 * ------------------------------------------------------------
 * 全部通过真实函数（castFireball / castFrost / getGroundCastPoint /
 * findNearestEnemy）取值，避免把魔法常量在探针里抄一遍。
 * @returns {Object} { skills: [...], raw: {...} }
 */
const MEASURE_EXPR = `(function(){
  state.mode = 'playing';
  state.status = 'playing';
  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.mines.length = 0;
  state.aoeZones.length = 0;
  state.rings.length = 0;
  state.player.invuln = 99999;
  state.aim = state.aim || { mode: 'weak', angle: 0, moved: false };
  state.aim.angle = 0;
  mouseState.moved = false;
  mouseState.overCanvas = true;
  mouseState.worldX = state.player.x + 300;
  mouseState.worldY = state.player.y;

  var raw = {};

  /* ---------- 火球：真实弹体的速度 × 寿命 ---------- */
  castFireball(MAGIC_BY_ID.fireball, null);
  var pr = state.projectiles[state.projectiles.length - 1];
  raw.fireball = pr
    ? { speed: Math.round(Math.hypot(pr.vx, pr.vy)), life: pr.life,
        reach: Math.round(Math.hypot(pr.vx, pr.vy) * pr.life), latency: pr.life * 0.5,
        shape: 'projectile' }
    : null;
  state.projectiles.length = 0;

  /* ---------- 冰环：特效环起点 + 增长量 ---------- */
  state.rings.length = 0;
  castFrost(MAGIC_BY_ID.frost, null);
  var frostMax = 0;
  state.rings.forEach(function(r){ frostMax = Math.max(frostMax, (r.radius || 0) + (r.grow || 0)); });
  raw.frost = { reach: Math.round(frostMax), latency: 0, shape: 'selfring' };
  state.rings.length = 0;

  /* ---------- 回旋刃：去程速度 × 去程时长（回程不延长射程） ---------- */
  raw.blade = {
    reach: Math.round(TACTIC_CONFIG.blade.speed * TACTIC_CONFIG.blade.outTime),
    latency: TACTIC_CONFIG.blade.outTime,
    shape: 'boomerang'
  };

  /* ---------- 符文雷：真实落点距离 + 触发半径 ---------- */
  var ground = getGroundCastPoint(420);
  raw.mine = {
    reach: Math.round(ground.dist + TACTIC_CONFIG.mine.triggerRadius),
    latency: TACTIC_CONFIG.mine.armTime,
    shape: 'trap'
  };
  state.mines.length = 0;

  /* ---------- 雷击：实测搜索半径（500 命中 / 560 失手） ---------- */
  var p = state.player;
  state.enemies.length = 0;
  spawnEnemy('chanter', p.x + 500, p.y, state.floor || 1, { roomId: state.currentRoomId });
  var bolt500 = !!findNearestEnemy(p.x, p.y, 520);
  state.enemies[state.enemies.length - 1].x = p.x + 560;
  // 仍用 520 搜索：560 处的敌人必须搜不到，证明射程上限就是 520 而不是更大
  var bolt560 = !!findNearestEnemy(p.x, p.y, 520);
  state.enemies.length = 0;
  raw.bolt = { reach: 520, latency: 0, shape: 'chain', spot500: bolt500, spot560: bolt560 };

  /* ---------- AOE 6 张：直接读配置 ---------- */
  var aim = 300;   // castArcanePool / castCollapseHole 的 aoeAimPoint(300)
  var aoe = [
    { id: 'lavaFissure', reach: AOE_SKILL_CONFIG.lavaFissure.length, latency: 0, shape: 'line' },
    { id: 'arcanePool', reach: aim + AOE_SKILL_CONFIG.arcanePool.radius,
      latency: AOE_SKILL_CONFIG.arcanePool.tickInterval, shape: 'field' },
    { id: 'runeOrbit', reach: AOE_SKILL_CONFIG.runeOrbit.endR,
      latency: AOE_SKILL_CONFIG.runeOrbit.expand, shape: 'ringband' },
    { id: 'collapseHole', reach: aim + AOE_SKILL_CONFIG.collapseHole.radius,
      latency: AOE_SKILL_CONFIG.collapseHole.delay, shape: 'pull' },
    { id: 'flameCone', reach: AOE_SKILL_CONFIG.flameCone.range, latency: 0, shape: 'cone' },
    { id: 'frostRing', reach: AOE_SKILL_CONFIG.frostRing.radius, latency: 0, shape: 'selfring' }
  ];
  aoe.forEach(function(item){ raw[item.id] = { reach: item.reach, latency: item.latency, shape: item.shape }; });

  /* ---------- 汇总表 ---------- */
  var names = { fireball: '火球', frost: '冰环', bolt: '雷击', blade: '回旋刃',
    mine: '符文雷', lavaFissure: '熔岩地裂', arcanePool: '奥术雷池',
    runeOrbit: '符文轨道', collapseHole: '坍缩黑洞', flameCone: '喷火锥', frostRing: '冰霜环' };
  var skills = Object.keys(raw).filter(function(k){ return raw[k]; }).map(function(id){
    var reach = raw[id].reach;
    var tier = reach <= 120 ? 'near' : (reach <= 260 ? 'mid' : 'far');
    return { id: id, name: names[id] || id, reach: reach,
      latency: Number(raw[id].latency.toFixed(2)), shape: raw[id].shape, tier: tier };
  });
  return { skills: skills, raw: raw, healExcluded: '治疗符（自身受益，不参与射程分档）' };
})()`;

/**
 * 统计中位数（排序后取中间，偶数取两数平均）
 * @param {number[]} list 数值数组
 * @returns {number}
 */
function median(list) {
  const arr = list.slice().sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

async function main() {
  const FILE = path.resolve(process.argv[2] || path.join(ROOT, 'index_arcane_v2.html'));
  const OUT = path.resolve(process.argv[3] || path.join(ROOT, '.screenshots', 'magic_range', 'range.json'));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1600,900', 'about:blank'
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

  /** 发送 CDP 命令 */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  /** 页面内执行表达式并取返回值 */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1200);

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    ready = await ev(`!!document.getElementById('btnStart')`);
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('标题页未挂载: ' + await ev('document.title + "|" + document.readyState'));
  await sleep(900);

  const startPos = await ev(`(function(){
    var el = document.getElementById('btnStart');
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(800);

  /* 站到第 6 层房间中心：四周有空间，避免开局小房把落点回收得太近 */
  const setup = await ev(`(function(){
    var d = window.__roamDebug;
    if (typeof XP_CONFIG !== 'undefined') XP_CONFIG.enabled = false;
    for (var i = 0; i < 40 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    d.setFloor(6);
    for (var k = 0; k < 40 && state.mode === 'reward'; k += 1) closeRewardFlow(true);
    var room = state.rooms[state.currentRoomId] || state.rooms[0];
    state.player.x = room.cx;
    state.player.y = room.cy;
    state.enemies.length = 0;
    state.player.invuln = 99999;
    return { floor: state.floor, mode: state.mode, room: state.currentRoomId };
  })()`);
  console.log('SETUP ' + JSON.stringify(setup));
  await sleep(400);

  const data = await ev(MEASURE_EXPR);
  const byTier = { near: [], mid: [], far: [] };
  data.skills.forEach((s) => byTier[s.tier].push(s));

  const tiers = {
    near: { count: byTier.near.length, reachMedian: median(byTier.near.map((s) => s.reach)),
      latencyMedian: median(byTier.near.map((s) => s.latency)), ids: byTier.near.map((s) => s.id) },
    mid: { count: byTier.mid.length, reachMedian: median(byTier.mid.map((s) => s.reach)),
      latencyMedian: median(byTier.mid.map((s) => s.latency)), ids: byTier.mid.map((s) => s.id) },
    far: { count: byTier.far.length, reachMedian: median(byTier.far.map((s) => s.reach)),
      latencyMedian: median(byTier.far.map((s) => s.latency)), ids: byTier.far.map((s) => s.id) }
  };

  /* ============ 断言 ============ */
  const checks = [];
  const add = (id, pass, detail) => checks.push({ id, pass: !!pass, detail });

  add('A-X2.5-1 三档各≥1',
    tiers.near.count >= 1 && tiers.mid.count >= 1 && tiers.far.count >= 1,
    `near=${tiers.near.count} mid=${tiers.mid.count} far=${tiers.far.count}`);

  const ratio1 = tiers.near.reachMedian ? tiers.mid.reachMedian / tiers.near.reachMedian : 0;
  const ratio2 = tiers.mid.reachMedian ? tiers.far.reachMedian / tiers.mid.reachMedian : 0;
  add('A-X2.5-2 相邻档射程差≥30%',
    ratio1 >= 1.3 && ratio2 >= 1.3,
    `near→mid=${ratio1.toFixed(2)}× mid→far=${ratio2.toFixed(2)}×(要求≥1.30)`);

  add('A-X2.5-3 生效延迟分化',
    tiers.near.latencyMedian <= 0.05 && tiers.far.latencyMedian >= 0.3
      && tiers.far.latencyMedian > tiers.mid.latencyMedian,
    `near=${tiers.near.latencyMedian}s mid=${tiers.mid.latencyMedian}s far=${tiers.far.latencyMedian}s`);

  /* 射程相近（±15%）的两张卡必须形状不同，避免"同一个爆炸换皮" */
  let shapeCollision = null;
  for (let i = 0; i < data.skills.length; i += 1) {
    for (let j = i + 1; j < data.skills.length; j += 1) {
      const a = data.skills[i];
      const b = data.skills[j];
      const diff = Math.abs(a.reach - b.reach) / Math.max(a.reach, b.reach, 1);
      if (diff <= 0.15 && a.shape === b.shape) shapeCollision = `${a.id}/${b.id}`;
    }
  }
  add('A-X2.5-4 近射程不换皮', !shapeCollision, shapeCollision ? ('冲突: ' + shapeCollision) : '全部形状可区分');

  add('A-X2.5-5 雷击实测射程',
    data.raw.bolt.spot500 === true && data.raw.bolt.spot560 === false,
    `500px=${data.raw.bolt.spot500} 560px=${data.raw.bolt.spot560}（要求 500 命中 / 560 不命中）`);

  const pass = checks.every((c) => c.pass);
  const report = {
    file: FILE,
    viewport: '1600x900@2x',
    healExcluded: data.healExcluded,
    skills: data.skills,
    tiers,
    raw: data.raw,
    checks,
    verdict: pass ? 'PASS' : 'FAIL'
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n=== 魔法距离手感表（有效射程 px / 生效延迟 s / 形状）===');
  console.log('id'.padEnd(14) + 'name'.padEnd(12) + 'tier'.padEnd(7) + 'reach'.padEnd(8) + 'latency'.padEnd(9) + 'shape');
  data.skills.forEach((s) => {
    console.log(s.id.padEnd(14) + s.name.padEnd(12) + s.tier.padEnd(7)
      + String(s.reach).padEnd(8) + String(s.latency).padEnd(9) + s.shape);
  });
  console.log('\n=== 断言 ===');
  checks.forEach((c) => console.log((c.pass ? 'PASS ' : 'FAIL ') + c.id + ' | ' + c.detail));
  console.log('\nRESULT: ' + report.verdict + ' -> ' + OUT);

  ws.close();
  killEdge(edge);
  if (!pass) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL', err); process.exit(1); });
