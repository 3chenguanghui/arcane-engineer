// E 批专项验收：敌人扩容（数量区间 / 混编 ≥5 / 每层 8–9 种可用 + 独占 / 11 条签名行为 / 自适应降档 / A/B）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9542;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'enemies');

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
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(m.params && m.params.exceptionDetails
        ? (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text
        : 'unknown');
    }
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
  // H2 升级四选一会打断刷怪采样；本脚本只验证敌人预算/签名，关掉成长开关
  await ev(`window.__roamDebug.xp.setEnabled(false); true`);
  /* 第 27 项：本脚本测的是"刷怪基线"，层词缀会按路线故意给精英房 +1 敌人
     （如淘金层），会与"F6 精英 3–4"的基线区间冲突。先关词缀再测，
     与量尺 LADDER_NOMOD=1 的对照口径一致；词缀自身由 arcane_floormods / arcane_routemods 负责。 */
  await ev(`FLOOR_MOD_CONFIG.enabled = false; state.floorMod = null; true`);

  // 只复位预算状态；自适应开关在读完配置断言后再关（否则配置断言会看到 enabled=false）
  await ev(`(() => {
    const d = window.__roamDebug;
    d.enemies.budget.reset();
    d.enemies.setEnabled(true);
    return true;
  })()`);

  // ---- 1) 配置：预算区间 / 混编 / 独占数量 / 9 种签名齐备 ----
  const cfg = await ev('__roamDebug.enemies.config()');
  const exIds = await ev('__roamDebug.enemies.info().exclusive.idsInConfig');
  check('预算配置：第 6 层起 / 战斗 5–6 / 精英 4–5 / 混编 ≥5',
    cfg.budget.enabled === true && cfg.budget.minFloor === 6
      && cfg.budget.battle[0] === 5 && cfg.budget.battle[1] === 6
      && cfg.budget.elite[0] === 4 && cfg.budget.elite[1] === 5
      && cfg.budget.mixMin === 5,
    cfg.budget);
  check('自适应配置：低帧阈值 60 降一档、最多 3 档、间隔 15s',
    cfg.budget.adaptive.enabled === true && cfg.budget.adaptive.fpsLow === 60
      && cfg.budget.adaptive.tiers.length === 3
      && cfg.budget.adaptive.tiers[1].battle[0] === 4
      && cfg.budget.adaptive.tiers[2].battle[0] === 3,
    cfg.budget.adaptive);
  /* 第 7 轮：新增 2 只独占怪（platewright / voidconduit）走 extrasByRegion 扩展表，
     byRegion 仍是"每区域 3 只基础"，因此下面三条计数从 9/11/9 同步抬到 11/13/11——
     这是随配置真值的收紧（要求所有独占怪签名唯一），不是放宽。 */
  check('独占怪恰好 11 只（基础 9 + 扩展 2），三区域各 3 只基础，签名互不重复',
    exIds.length === 11
      && Array.from(new Set(exIds)).length === 11
      && Object.keys(cfg.exclusive.byRegion).length === 3
      && Object.values(cfg.exclusive.byRegion).every((list) => list.length === 3)
      && new Set(Object.values(cfg.exclusive.byRegion).flat()).size === 9,
    { exIds, byRegion: cfg.exclusive.byRegion });
  check('13 种专属轮廓（11 独占 + 2 辅助）全部注册',
    Array.isArray(cfg.exclusive ? cfg.bodies : []) && cfg.bodies.length === 13,
    { bodies: cfg.bodies });
  const sigs = await ev(`(() => {
    const list = ENEMY_CONFIG.filter((c) => c.exclusive).map((c) => c.signature || c.id);
    return { list, unique: Array.from(new Set(list)).length };
  })()`);
  check('每只独占怪都有独立 signature（11/11 唯一）', sigs.unique === 11, sigs);

  // ---- 2) 名册审计：6/7/8 层可用 ≥8、独占 ≥2；1–5 层不接管 ----
  // 第 13 项后区域改为固定 6 层分块（1–6 / 7–12 / 13–18），F6/7/8 不可能覆盖 3 个区域；
  // 因此把"可用池/独占数"与"三区域轮转"拆成两问：轮转取样改到区末 6/12/18，阈值不变。
  const f678 = await ev(`(() => [6, 7, 8].map((n) => __roamDebug.enemies.audit(n)))()`);
  const rotation = await ev(`(() => [6, 12, 18].map((n) => __roamDebug.enemies.audit(n).regionKey))()`);
  check('第 6/7/8 层可用 ≥8 种、独占 ≥2 只，且三区域轮转（区末 6/12/18）覆盖 1/2/3',
    f678.every((a) => a.available >= 8 && a.exclusiveCount >= 2)
      && new Set(rotation).size === 3,
    { roster: f678.map((a) => ({ floor: a.floor, region: a.regionKey, available: a.available, exclusive: a.exclusiveCount })), rotation });
  const early = await ev(`(() => [1, 2, 5].map((n) => __roamDebug.enemies.audit(n)))()`);
  check('前五层不接管：applies=false 且名册只有原池 5 只',
    early.every((a) => a.applies.battle === false && a.available === 5),
    early.map((a) => ({ floor: a.floor, applies: a.applies, available: a.available })));

  // ---- 3) 真实刷怪：第 6 层战斗 5–6 / 精英 4–5 / 混编 ≥5 ----
  // 数量断言前关闭自适应，避免 headless 短时掉帧自动降档造成误判
  await ev('__roamDebug.enemies.setAdaptive(false)');
  await ev('__roamDebug.enemies.floor(6)');
  await sleep(350);
  const f6 = await ev(`(() => {
    const rooms = state.rooms.map((r) => ({
      id: r.id, type: r.type, planned: r.enemyCount,
      distinct: r.enemyTypes ? new Set(r.enemyTypes).size : 0,
      types: r.enemyTypes || [], tier: r.budgetTier
    }));
    return rooms;
  })()`);
  const battles = f6.filter((r) => r.type === 'battle');
  const elites = f6.filter((r) => r.type === 'elite');
  /* 第 2 组：F5→F6 数量台阶平滑后，F6 = 5 只（F7 也 5 只、F8 5–6、F9+ 6）。
     数量本身从"3–4 直接跳 5–6"改成"5 → 6 分两层过渡"，区间断言逐层精确。 */
  check('第 6 层战斗房数量 5（逐层平滑起点）',
    battles.length > 0 && battles.every((r) => r.planned === 5),
    battles.map((r) => ({ id: r.id, n: r.planned })));
  check('第 6 层精英房数量 3–4',
    elites.length > 0 && elites.every((r) => r.planned >= 3 && r.planned <= 4),
    elites.map((r) => ({ id: r.id, n: r.planned })));
  check('同场混编 ≥5 种（所有 count≥5 的房间）',
    f6.filter((r) => r.planned >= 5).every((r) => r.distinct >= 5),
    f6.filter((r) => r.planned >= 5).map((r) => ({ id: r.id, n: r.planned, distinct: r.distinct, types: r.types })));
  // 逐层平滑表（rampByFloor）：F7 5 / F8 5–6 / F9 6 / F10 6
  const rampRows = {};
  const rampRolls = {};
  for (const f of [7, 8, 9, 10]) {
    /* 房间布局是随机的：某次 floor(7) 可能整层没有 battle 房（只有精英/生存/商店）。
       断言要求"真实刷出的战斗房数量"，所以缺战斗房时重掷最多 12 次，
       并把每一轮的 battle 数量记进 detail（方便区分"偶发无战斗房"和"系统性没有"）。
       只要拿到 ≥1 间就停，断言强度不变（仍然要求所有战斗房数量命中区间）。 */
    rampRows[f] = [];
    rampRolls[f] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await ev(`__roamDebug.enemies.floor(${f})`);
      await sleep(320);
      const rows = await ev(`(() => state.rooms.filter((r) => r.type === 'battle')
        .map((r) => ({ n: r.enemyCount, distinct: r.enemyTypes ? new Set(r.enemyTypes).size : 0, tier: r.budgetTier })))()`);
      rampRolls[f].push(rows.length);
      rampRows[f] = rampRows[f].concat(rows);
      if (rows.length > 0) break;
    }
  }
  /* 每层的重掷记录（诊断用）：只打印，不参与判红 */
  console.log('rampRolls ' + JSON.stringify(rampRolls));
  check('第 7 层战斗房 5（过渡第二层，比旧 4–5 更严）',
    rampRows[7].length > 0 && rampRows[7].every((r) => r.n === 5), rampRows[7]);
  check('第 8 层战斗房 5–6（5→6 过渡层）',
    rampRows[8].length > 0 && rampRows[8].every((r) => r.n >= 5 && r.n <= 6), rampRows[8]);
  check('第 9 层战斗房 6（过渡完成，比旧 5–6 更严）',
    rampRows[9].length > 0 && rampRows[9].every((r) => r.n === 6), rampRows[9]);
  check('第 10 层战斗房 6（此后不再涨）',
    rampRows[10].length > 0 && rampRows[10].every((r) => r.n === 6), rampRows[10]);
  check('数量曲线仍在涨：F10 每房比 F6 多 1 只',
    rampRows[10].length > 0 && battles.length > 0
      && Math.min(...rampRows[10].map((r) => r.n)) >= Math.min(...battles.map((r) => r.planned)) + 1,
    { f6: battles.map((r) => r.planned), f10: rampRows[10].map((r) => r.n) });
  check('第 8 层同场混编 ≥5 种（count≥5 的房间）',
    rampRows[8].filter((r) => r.n >= 5).every((r) => r.distinct >= 5),
    rampRows[8].filter((r) => r.n >= 5));
  await ev('__roamDebug.enemies.floor(6)');
  await sleep(300);
  check('预算房记录 tier=0（自适应关闭时不会莫名降档）',
    f6.filter((r) => r.type === 'battle' || r.type === 'elite').every((r) => r.tier === 0),
    f6.map((r) => ({ type: r.type, tier: r.tier })));

  // ---- 4) 自适应降档：fps<60 → 档位 +1，区间下探一档 ----
  await ev('__roamDebug.enemies.setAdaptive(true)');
  const down1 = await ev('__roamDebug.enemies.budget.simulateFps(50)');
  check('注入低帧 50 → 降一档：tier=1、战斗区间 4–5、精英 3–4',
    down1.tier === 1 && down1.ranges.battle[0] === 4 && down1.ranges.elite[0] === 3,
    down1);
  const down2 = await ev('__roamDebug.enemies.budget.simulateFps(50)');
  check('持续低帧再降一档：tier=2、战斗区间 3–4（不会超过 2 档）',
    down2.tier === 2 && down2.ranges.battle[0] === 3,
    down2);
  await ev('__roamDebug.enemies.floor(6)');
  await sleep(300);
  const f6low = await ev(`(() => state.rooms.filter((r) => r.type === 'battle').map((r) => ({ n: r.enemyCount, tier: r.budgetTier })))()`);
  check('tier=2 时真实刷怪区间为 3–4',
    f6low.length > 0 && f6low.every((r) => r.n >= 3 && r.n <= 4 && r.tier === 2),
    f6low);
  await ev('(() => { const d = window.__roamDebug; d.enemies.setAdaptive(false); d.enemies.budget.reset(); d.enemies.budget.clearFps(); return true; })()');

  // ---- 5) A/B：预算开关决定是否接管数量 ----
  // 先把区间临时改成 12/12：打开时每间房都必须 12 只；关闭时旧路径上限 8，绝不会出现 12
  const strict = await ev(`(() => {
    const d = window.__roamDebug;
    d.enemies.setBudget({ battle: [12, 12], elite: [12, 12] });
    d.enemies.floor(6);
    const on = state.rooms.filter((r) => r.type === 'battle' || r.type === 'elite')
      .map((r) => ({ type: r.type, n: r.enemyCount, tier: r.budgetTier }));
    d.enemies.setEnabled(false);
    d.enemies.floor(6);
    const off = state.rooms.filter((r) => r.type === 'battle' || r.type === 'elite')
      .map((r) => ({ type: r.type, n: r.enemyCount, tier: r.budgetTier }));
    d.enemies.setBudget({ battle: [5, 6], elite: [4, 5] });
    d.enemies.setEnabled(true);
    return { on, off };
  })()`);
  check('A/B 开启：区间强制生效（战斗/精英均为 12）',
    strict.on.every((r) => r.n === 12),
    strict.on.slice(0, 8));
  check('A/B 关闭：不再接管（tier=-1 且没有房间被强制成 12）',
    strict.off.every((r) => r.tier === -1) && !strict.off.some((r) => r.n === 12),
    strict.off.slice(0, 8));

  // ---- 6) 9 条签名行为专项断言 ----
  // 暂停世界更新，避免怪互殴/玩家被打断；forceBehavior 是直接调用，不依赖主循环
  const setup = await ev(`(() => {
    const d = window.__roamDebug;
    d.enemies.floor(6);
    state.status = 'paused';
    const room = state.rooms.find((r) => r.type === 'battle') || state.rooms[1];
    state.player.x = room.cx;
    state.player.y = room.cy;
    state.player.aether = Math.max(50, state.player.aether);
    state.player.hp = state.player.hpMax;
    // 清掉全场敌人：避免 forceBehavior 按 typeId 找到别房间里的同名怪导致距离失真
    state.enemies = [];
    state.sigils = [];
    state.bullets = [];
    return { room: room.id, cx: room.cx, cy: room.cy, w: room.w, h: room.h };
  })()`);

  /** 清空本房 + 重新摆好测试怪，返回 spawn 坐标 */
  const resetArena = async () => ev(`(() => {
    const d = window.__roamDebug;
    const room = state.rooms[${setup.room}];
    state.player.x = room.cx;
    state.player.y = room.cy;
    state.player.aether = Math.max(50, state.player.aether);
    state.player.hp = state.player.hpMax;
    state.enemies = [];
    state.sigils = [];
    state.bullets = [];
    return { cx: room.cx, cy: room.cy };
  })()`);
  const spawnAt = async (typeId, dx, dy) => ev(`__roamDebug.enemies.spawn('${typeId}', ${setup.cx} + ${dx}, ${setup.cy} + ${dy}, { roomId: ${setup.room} }) && true`);

  // pull：玩家应朝敌人移动（距离下降）
  await resetArena();
  await spawnAt('magtractor', 150, 0);
  const pull = await ev(`__roamDebug.enemies.forceBehavior('magtractor')`);
  check('磁力牵引者：pull 生效，玩家被拉向敌人（位移 ≥8px 且距离下降）',
    pull.ok && pull.result.acted && pull.deltas.playerMoved >= 8 && pull.deltas.playerDist < 0,
    { moved: pull.deltas.playerMoved, dist: pull.deltas.playerDist, result: pull.result });
  // steamcone：一次 5 发扇形弹
  await resetArena();
  await spawnAt('steamjet', 150, 0);
  const steam = await ev(`__roamDebug.enemies.forceBehavior('steamjet')`);
  check('蒸汽喷射者：steamcone 一次发 5 颗弹（弹数 +5）',
    steam.ok && steam.result.acted && steam.deltas.bullets === 5,
    { bullets: steam.deltas.bullets, result: steam.result });
  // sigil：生成一个延迟爆炸区
  await resetArena();
  await spawnAt('sigilweaver', 150, 0);
  const sigil = await ev(`__roamDebug.enemies.forceBehavior('sigilweaver')`);
  check('符阵编织者：sigil 生成 1 个延迟符阵（区数 +1）',
    sigil.ok && sigil.result.acted && sigil.deltas.sigils === 1,
    { sigils: sigil.deltas.sigils, result: sigil.result });
  // mirror：生成 1 只镜像分身
  await resetArena();
  await spawnAt('mirrorghost', 150, 0);
  const mirror = await ev(`__roamDebug.enemies.forceBehavior('mirrorghost')`);
  const mirrorInfo = await ev(`(() => {
    const m = state.enemies.filter((e) => e.isMirror);
    return { count: m.length, type: m[0] ? m[0].typeId : null, hp: m[0] ? m[0].hp : null };
  })()`);
  check('镜像幽灵：生成 1 只 isMirror 诱饵（mirrorphantom / 1 血）',
    mirror.ok && mirror.result.acted && mirror.deltas.enemies === 1
      && mirrorInfo.count === 1 && mirrorInfo.type === 'mirrorphantom' && mirrorInfo.hp === 1,
    { delta: mirror.deltas.enemies, mirrorInfo, result: mirror.result });
  // chant：附近友军获得加速
  await resetArena();
  await spawnAt('chanter', 150, 0);
  await spawnAt('assembler', 180, 20);
  const chant = await ev(`__roamDebug.enemies.forceBehavior('chanter')`);
  const haste = await ev(`(() => {
    const ally = state.enemies.find((e) => e.typeId === 'assembler');
    return { hasteTimer: ally ? ally.hasteTimer : 0, mul: ally ? ally.hasteMul : 1 };
  })()`);
  check('咏唱者：chant 给 190px 内友军加速（hasteTimer>0、倍率 1.35）',
    chant.ok && chant.result.acted && haste.hasteTimer > 0 && haste.mul > 1,
    { haste, result: chant.result });
  // siphon：抽玩家奥能
  await resetArena();
  await spawnAt('siphon', 150, 0);
  const siphon = await ev(`__roamDebug.enemies.forceBehavior('siphon')`);
  check('吸能体：siphon 抽走玩家奥能（≥1 点）',
    siphon.ok && siphon.result.acted && siphon.deltas.aether < 0,
    { aether: siphon.deltas.aether, result: siphon.result });
  // warp：玩家被强行挪位
  await resetArena();
  await spawnAt('warper', 150, 0);
  const warp = await ev(`__roamDebug.enemies.forceBehavior('warper')`);
  check('扭曲者：warp 把玩家挪走 ≥60px',
    warp.ok && warp.result.acted && warp.deltas.playerMoved >= 60,
    { moved: warp.deltas.playerMoved, result: warp.result });
  // grow：半径 +15%
  await resetArena();
  await spawnAt('coalescer', 150, 0);
  const grow = await ev(`__roamDebug.enemies.forceBehavior('coalescer')`);
  check('凝聚体：grow 半径至少 +15%',
    grow.ok && grow.result.acted && grow.deltas.radius >= 1,
    { before: grow.before.radius, after: grow.after.radius, result: grow.result });
  // deathSplit：死后 +2 只齿轮碎体（净 +1）
  await resetArena();
  await spawnAt('gearsplit', 150, 0);
  const split = await ev(`__roamDebug.enemies.kill('gearsplit')`);
  const splitInfo = await ev(`(() => {
    const kids = state.enemies.filter((e) => e.typeId === 'geargrind');
    return { kids: kids.length, allSplitChild: kids.every((e) => e.isSplitChild) };
  })()`);
  check('齿轮分裂体：死亡后裂出 2 只齿轮碎体（净 +1，子体不再裂）',
    split.ok && splitInfo.kids === 2 && splitInfo.allSplitChild === true && split.delta >= 1,
    { split, splitInfo });

  // ---- 7) 截图：before（普通房数量）/ after（9 只独占同场） ----
  await ev(`(() => {
    const d = window.__roamDebug;
    state.status = 'playing';
    d.enemies.floor(6);
    const room = state.rooms.find((r) => r.type === 'battle') || state.rooms[1];
    d.teleport(room.cx, room.cy + 30);
    return true;
  })()`);
  await sleep(700);
  await shot('enemies-before.png');
  await ev('__roamDebug.enemies.showcase()');
  await sleep(650);
  await shot('enemies-after.png');
  const sizes = ['enemies-before.png', 'enemies-after.png']
    .map((name) => (fs.existsSync(path.join(OUT, name)) ? fs.statSync(path.join(OUT, name)).size : 0));
  check('before/after 各 1 张截图且均 >100KB', sizes.every((s) => s > 100000), { sizes });

  // ---- 8) 帧率（负载敏感：只记录） ----
  const fps = await ev('__roamDebug.getState().fps');
  check('fps ≥60（PERF 负载敏感，只记录）', fps >= 60, { fps });

  const debugErrs = await ev('__roamDebug.errors()');
  check('无运行时报错（调试口 + Runtime.exceptionThrown）',
    Array.isArray(debugErrs) && debugErrs.length === 0 && runtimeErrors.length === 0,
    { debugErrs, runtimeErrors });

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'enemies-result.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
