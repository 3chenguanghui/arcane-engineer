// A 批专项验收：6 条范围技能（形状 / 命中 ≥4 / 开关 A/B）+ 科技 2 张 + 融合 3 条 + 奖励四选一
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9543;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'abatch');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;

/** 记录一条断言并打印 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

// 6 条技能 / 各自形状 / 命中判定用的人数
const SKILLS = [
  { id: 'lavaFissure', shape: 'line', wait: 200 },
  { id: 'arcanePool', shape: 'field', wait: 900 },
  { id: 'runeOrbit', shape: 'ringband', wait: 200 },
  { id: 'collapseHole', shape: 'pull', wait: 1500 },
  { id: 'flameCone', shape: 'cone', wait: 200 },
  { id: 'frostRing', shape: 'selfring', wait: 200 }
];

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

  // 固定到第 1 层，避免首轮就有高难度怪打断断言
  await ev(`(() => { const d = window.__roamDebug; d.enemies.floor(1); return true; })()`);
  await sleep(300);
  await shot('before.png');

  // ---- 1) 配置层：12 / 8 / 13，6 种形状互不重复 ----
  const info = await ev('__roamDebug.abatch.info()');
  check('卡池数量：魔法 12 / 科技 8 / 融合 13',
    info.counts.magic === 12 && info.counts.tech === 8 && info.counts.fusion === 13,
    info.counts);
  const shapes = info.aoe.shapes.map((s) => s.shape);
  const shapeIds = info.aoe.shapes.map((s) => s.id);
  check('6 条 AOE 形状齐备且互不重复（line/field/ringband/pull/cone/selfring）',
    info.aoe.shapes.length === 6
      && new Set(shapes).size === 6
      && ['line', 'field', 'ringband', 'pull', 'cone', 'selfring'].every((s) => shapes.includes(s)),
    info.aoe.shapes);
  check('6 条 AOE 全部进入魔法池（id 一一对应）',
    ['lavaFissure', 'arcanePool', 'runeOrbit', 'collapseHole', 'flameCone', 'frostRing']
      .every((id) => shapeIds.includes(id)),
    shapeIds);

  // 新号首抽（此时卡池还很满）：必须 4 张真实卡，不能直接掉补给
  const earlyRoll = await ev(`(() => {
    const a = __roamDebug.abatch.options('skill');
    return { a, choices: __roamDebug.abatch.info().choices };
  })()`);
  check('新号首抽：四选一全部来自真实卡池（≥3 张非补给）且 key 无重复',
    earlyRoll.a.length === 4
      && new Set(earlyRoll.a.map((o) => o.key)).size === 4
      && earlyRoll.a.filter((o) => o.kind !== 'supply').length >= 3,
    earlyRoll);

  // ---- 2) 6 条形状断言：每条命中 ≥4，并且记录形状 / 参数可区分 ----
  for (const skill of SKILLS) {
    await ev('__roamDebug.abatch.resetCasts()');
    const cast = await ev(`__roamDebug.abatch.cast('${skill.id}', 0)`);
    await sleep(140);
    await shot(`aoe-${skill.id}.png`);
    if (skill.wait > 140) await sleep(skill.wait - 140);
    const rec = await ev(`__roamDebug.abatch.last('${skill.id}')`);
    const p = (rec && rec.params) || {};
    let shapeOk = !!(rec && rec.shape === skill.shape);
    let extraOk = true;
    if (skill.id === 'lavaFissure') extraOk = p.length === 260 && p.width === 44;
    if (skill.id === 'arcanePool') extraOk = p.radius === 110 && p.tickInterval === 0.42;
    if (skill.id === 'runeOrbit') extraOk = p.startR === 40 && p.endR === 200;
    if (skill.id === 'collapseHole') extraOk = p.radius === 170 && p.pulled > 0;
    if (skill.id === 'flameCone') extraOk = p.range === 190 && p.angleDeg === 72;
    if (skill.id === 'frostRing') extraOk = p.radius === 140;
    check(`${skill.id}：形状=${skill.shape}、命中 ≥4、参数可区分`,
      cast.ok && shapeOk && extraOk && rec && rec.hits >= 4,
      { ok: cast.ok, shape: rec && rec.shape, hits: rec && rec.hits, params: p });
  }

  // 雷池额外断言：持续区域真的在跑（重新施放一次，避免前面循环里已经过期）
  await ev('__roamDebug.abatch.resetCasts()');
  await ev(`__roamDebug.abatch.cast('arcanePool', 0)`);
  await sleep(140);
  const poolZones = await ev(`(() => (state.aoeZones || []).map((z) => ({ type: z.type, life: Number(z.life.toFixed(2)) })))()`);
  await sleep(600);
  const poolRec = await ev(`__roamDebug.abatch.last('arcanePool')`);
  check('奥术雷池：留下 field 持续区域且命中数 ≥4',
    poolZones.some((z) => z.type === 'field') && poolRec && poolRec.hits >= 4,
    { zones: poolZones, hits: poolRec && poolRec.hits });

  // ---- 3) 开关 A/B：关闭后退化为自身中心爆炸，仍然能打中 ≥4 ----
  await ev('__roamDebug.abatch.set({ enabled: false })');
  for (const skill of SKILLS) {
    await ev('__roamDebug.abatch.resetCasts()');
    const cast = await ev(`__roamDebug.abatch.cast('${skill.id}', 0)`);
    await sleep(160);
    const rec = await ev(`__roamDebug.abatch.last('${skill.id}')`);
    check(`A/B 关闭：${skill.id} 退化为自身爆炸且命中 ≥4`,
      cast.ok && rec && rec.shape === 'fallback' && rec.hits >= 4,
      { ok: cast.ok, shape: rec && rec.shape, hits: rec && rec.hits });
  }
  await ev('__roamDebug.abatch.set({ enabled: true })');

  // ---- 4) 科技 2 张：相位甲致死拦截 / 时序器冷却重置 / 两个装置 ----
  await ev('__roamDebug.abatch.grantAll()');
  const phase1 = await ev(`(() => {
    state.player.hp = 8;
    state.player.invuln = 0;
    state.phaseSaveFloor = -1;
    return __roamDebug.abatch.hit(999);
  })()`);
  check('相位甲：致死伤害被拦截（hp=1、无敌 ≥1s、saved=true）',
    phase1.saved === true && phase1.hp === 1 && phase1.invuln >= 1,
    phase1);
  const phase2 = await ev(`(() => {
    state.floor = 2;
    state.player.hp = 8;
    state.player.invuln = 0;
    return __roamDebug.abatch.hit(999);
  })()`);
  check('相位甲：每层独立（换层后第二次致死仍被拦截）',
    phase2.saved === true && phase2.hp === 1,
    phase2);
  await ev(`(() => { state.player.hp = state.player.hpMax; state.player.invuln = 0; return true; })()`);
  const phaseDev = await ev(`(() => {
    const room = state.rooms[state.currentRoomId] || state.rooms[0];
    state.player.x = room.cx; state.player.y = room.cy;
    state.player.invuln = 0;
    return __roamDebug.abatch.device('phase');
  })()`);
  const phaseMoved = Math.hypot(phaseDev.after.x - phaseDev.before.x, phaseDev.after.y - phaseDev.before.y);
  check('相位跃迁装置：位移 ≥60px 且获得无敌（≥0.5s）',
    phaseDev.ok && phaseMoved >= 60 && phaseDev.after.invuln >= 0.5,
    { moved: Math.round(phaseMoved), invuln: phaseDev.after.invuln, device: phaseDev.device });
  const rewindDev = await ev(`(() => {
    state.cooldowns = { lavaFissure: 3, frostRing: 2, fireball: 1 };
    state.player.aether = 10;
    return __roamDebug.abatch.device('rewind');
  })()`);
  const cdCleared = Object.keys(rewindDev.after.cd).every((k) => rewindDev.after.cd[k] === 0);
  check('时序归零装置：全部魔法冷却清零 + 奥能 +6',
    rewindDev.ok && cdCleared && rewindDev.after.aether - rewindDev.before.aether >= 6,
    { cd: rewindDev.after.cd, aetherBefore: rewindDev.before.aether, aetherAfter: rewindDev.after.aether });

  // ---- 5) 融合 3 条：三态 / P4 文案 / 树节点 13 ----
  const nodesReady = await ev('__roamDebug.abatch.fusionNodes()');
  const newFusions = ['lavaBand', 'drainRing', 'frostFlame'];
  check('融合节点 13 条，新增 3 条全部注册',
    nodesReady.length === 13 && newFusions.every((id) => nodesReady.some((n) => n.id === id)),
    { total: nodesReady.length, ids: nodesReady.map((n) => n.id) });
  check('集齐父模块后：新增 3 条融合均为 ready（可凑出）',
    nodesReady.filter((n) => newFusions.includes(n.id)).every((n) => n.state === 'ready'),
    nodesReady.filter((n) => newFusions.includes(n.id)));
  const hints = await ev(`(() => ({
    lava: __roamDebug.abatch.hint('magic', 'lavaFissure'),
    hole: __roamDebug.abatch.hint('magic', 'collapseHole'),
    frost: __roamDebug.abatch.hint('magic', 'frostRing'),
    cap: __roamDebug.abatch.hint('tech', 'capacitor'),
    magnet: __roamDebug.abatch.hint('tech', 'magnet'),
    amp: __roamDebug.abatch.hint('tech', 'amp')
  }))()`);
  check('P4 推荐文案覆盖 3 条新融合（卡面 can 态且文案含融合名）',
    hints.lava && hints.lava.state === 'can' && hints.lava.text.includes('熔雷带')
      && hints.hole && hints.hole.state === 'can' && hints.hole.text.includes('吸噬环')
      && hints.frost && hints.frost.state === 'can' && hints.frost.text.includes('霜焰爆发'),
    { lava: hints.lava && hints.lava.text, hole: hints.hole && hints.hole.text, frost: hints.frost && hints.frost.text });
  const ownedTree = await ev(`(() => {
    __roamDebug.abatch.fuseAll();
    return __roamDebug.abatch.fusionNodes();
  })()`);
  check('融合后：13 条节点全部 owned（技能树三态可读）',
    ownedTree.length === 13 && ownedTree.every((n) => n.state === 'owned'),
    ownedTree.map((n) => n.state).slice(0, 13));

  // ---- 6) 奖励四选一：默认 4、可回 3、同次无重复 ----
  const four = await ev(`(() => {
    __roamDebug.abatch.setChoices({ enabled: true, count: 4 });
    const a = __roamDebug.abatch.options('skill');
    const b = __roamDebug.abatch.options('skill');
    return { a, b, resolved: __roamDebug.abatch.info().choices };
  })()`);
  check('四选一：默认取 4 张且 key 无重复（抽两次都不重复）',
    four.resolved.count === 4 && four.resolved.resolved === 4
      && four.a.length === 4 && four.b.length === 4
      && new Set(four.a.map((o) => o.key)).size === 4
      && new Set(four.b.map((o) => o.key)).size === 4,
    { resolved: four.resolved, a: four.a.map((o) => o.key), b: four.b.map((o) => o.key) });
  const three = await ev(`(() => {
    __roamDebug.abatch.setChoices({ count: 3 });
    const a = __roamDebug.abatch.options('skill');
    return { a, resolved: __roamDebug.abatch.info().choices };
  })()`);
  check('A/B 回三选一：count=3 时只出 3 张',
    three.resolved.resolved === 3 && three.a.length === 3,
    { resolved: three.resolved, n: three.a.length });
  await ev('__roamDebug.abatch.setChoices({ enabled: true, count: 4 })');

  // ---- 7) UI 同步：卡组 12 魔法 + 8 科技，技能树 13 个融合节点 ----
  const deck = await ev(`(() => ({
    magic: document.querySelectorAll('.mini-card.magic').length,
    tech: document.querySelectorAll('.mini-card.tech').length,
    magicNames: Array.from(document.querySelectorAll('.mini-card.magic')).map((el) => el.getAttribute('data-magic-id'))
  }))()`);
  check('卡面 UI 覆盖 12 张魔法（含 6 条 AOE）与 8 张科技',
    deck.magic === 12 && deck.tech === 8
      && ['lavaFissure', 'arcanePool', 'runeOrbit', 'collapseHole', 'flameCone', 'frostRing']
        .every((id) => deck.magicNames.includes(id)),
    deck);
  const tree = await ev(`(() => {
    openPanel('skilltree');
    const fusion = document.querySelectorAll('[data-tree-node^="fusion:"]').length;
    const magic = document.querySelectorAll('[data-tree-node^="magic:"]').length;
    const tech = document.querySelectorAll('[data-tree-node^="tech:"]').length;
    closePanel('skilltree');
    return { fusion, magic, tech };
  })()`);
  check('技能树节点：融合 13（10 → 13）、魔法 12、科技 8',
    tree.fusion === 13 && tree.magic === 12 && tree.tech === 8,
    tree);

  // ---- 8) 帧率 / 报错 ----
  const fps = await ev('__roamDebug.getState().fps');
  check('fps ≥60（PERF 负载敏感，只记录）', fps >= 60, { fps });
  const debugErrs = await ev('__roamDebug.errors()');
  check('无运行时报错（调试口 + Runtime.exceptionThrown）',
    Array.isArray(debugErrs) && debugErrs.length === 0 && runtimeErrors.length === 0,
    { debugErrs, runtimeErrors });

  const sizes = ['before.png'].concat(SKILLS.map((s) => `aoe-${s.id}.png`))
    .map((name) => (fs.existsSync(path.join(OUT, name)) ? fs.statSync(path.join(OUT, name)).size : 0));
  check('截图齐备：before + 6 张技能各 1 张（均 >60KB）',
    sizes.every((s) => s > 60000), { sizes });

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'abatch-result.json'), JSON.stringify({ pass, total: results.length, results }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
