/**
 * 第 6 轮 · 第 2 组验收：成就进度条 + 成就扩充
 * ------------------------------------------------------------
 * 覆盖：
 *   B1 配置：≥20 条、metric 全部有口径、每条 target>0 且奖励克制
 *   B2 逐条模拟达成（22 条全部有可达成路径），面板行数 = 配置行数
 *   B3 进度条数值与存档统计一致（面板 data-* / DOM 文本 / 存档三方对齐）
 *   B4 已达成不重复发放（再次 simulate 不涨奖励）
 *   B5 奖励写进存档并在下一局真实生效（奥能上限 / 起手多一张卡）
 *   B6 清档完全归零（新增统计 / 峰值 / 成就 / 进度条全部回零）
 *   B7 达成行置灰 + 显示日期
 *   B8 真实击杀钩子（eliteKills / comboPeak）确实累加
 *   B9 before / after 截图各 1 张
 *
 * 用法：node tools/arcane_meta20.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9764;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'meta20');
const RESULTS = path.join(OUT, 'meta20-result.json');

const checks = [];
const runtimeErrors = [];
let EDGE_PROC = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  EDGE_PROC = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口没起 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push(d ? ((d.exception || {}).description || d.text) : 'unknown');
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
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
        + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  // ---------- 启动 ----------
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(1200);

  // ---------- B1 配置 ----------
  const cfg = await ev('__roamDebug.meta2.config()');
  const achList = await ev('META_PROGRESS_CONFIG.achievements.map((a) => ({ id: a.id, metric: a.metric, target: a.target, reward: a.reward }))');
  const metricWhitelist = ['kills', 'deaths', 'bestFloor', 'clears', 'blueprints', 'recipes',
    'eliteKills', 'bossKills', 'flawlessFloors', 'hiddenRooms', 'voidRifts', 'singleSchoolClears',
    'comboPeak', 'runRecipes'];
  const badMetric = achList.filter((a) => metricWhitelist.indexOf(a.metric) < 0 || !(a.target > 0));
  const rewardSum = achList.reduce((s, a) => s + (Number(a.reward && a.reward.aether) || 0) * 1, 0);
  const cardCount = achList.filter((a) => a.reward && a.reward.cards).length;
  check('B1 成就 ≥20 条，metric 全有口径、target>0、奖励克制（奥能总额受上限约束、卡奖励仅 1 条）',
    cfg.count >= 20 && badMetric.length === 0 && cardCount === 1 && rewardSum >= 10 && cfg.maxAetherReward <= 12,
    { count: cfg.count, badMetric: badMetric, rewardSum: rewardSum, cardCount: cardCount, maxAether: cfg.maxAetherReward });

  // ---------- B2 逐条模拟达成 ----------
  await ev('__roamDebug.meta2.reset()');
  const sim = await ev(`(() => {
    const out = [];
    META_PROGRESS_CONFIG.achievements.forEach((item) => {
      const r = __roamDebug.meta2.simulate(item.id);
      out.push({ id: item.id, ok: r.ok, unlocked: r.unlocked, time: r.time, rewards: r.rewards });
    });
    return { out: out, info: __roamDebug.meta2.info(), prog: __roamDebug.meta2.progress() };
  })()`);
  const achieved = await ev('META_PROGRESS_CONFIG.achievements.filter((a) => !!state.meta.achievements[a.id]).length');
  const missing = sim.prog.rows.filter((r) => !r.done);
  check('B2 22 条逐条 simulate 全部达成（每条都有可达成路径）',
    achieved === achList.length && sim.out.every((r) => r.ok) && missing.length === 0 && sim.prog.count === achList.length,
    { achieved: achieved, total: achList.length, missing: missing.map((r) => r.id) });
  check('B2b 奖励随达成累加且受"奥能 +12 / 起手卡 +1"上限约束',
    sim.info.rewards.aether === Math.min(rewardSum, 12) && sim.info.rewards.cards === 1
    && sim.prog.grayRows === achList.length,
    { rewards: sim.info.rewards, capAether: cfg.maxAetherReward, grayRows: sim.prog.grayRows });

  // ---------- B3 进度条数值 = 存档统计 ----------
  await ev('__roamDebug.meta2.reset()');
  const aligned = await ev(`(() => {
    __roamDebug.meta2.bump('kills', 37);
    __roamDebug.meta2.bump('eliteKills', 12);
    state.meta.bestFloor = 4;
    const prog = __roamDebug.meta2.progress();
    const info = __roamDebug.meta2.info();
    const row = (id) => prog.rows.filter((r) => r.id === id)[0];
    const domText = document.querySelector('.archive-ach-row[data-id="kills_100"]').textContent;
    return {
      killsRow: row('kills_100'), eliteRow: row('elite_50'), floorRow: row('floor_5'),
      stats: { kills: info.metrics.kills, eliteKills: info.metrics.eliteKills, bestFloor: info.metrics.bestFloor },
      domText: domText,
      badPct: prog.rows.filter((r) => r.pct < 0 || r.pct > 100 || r.value > r.target).length
    };
  })()`);
  check('B3 进度条数值与实际统计一致（37/100、12/50、4/5，形态合法）',
    aligned.killsRow.value === 37 && aligned.killsRow.raw === 37 && aligned.killsRow.pct === 37
    && aligned.eliteRow.value === 12 && aligned.eliteRow.pct === 24
    && aligned.floorRow.value === 4 && aligned.floorRow.pct === 80
    && aligned.badPct === 0
    && aligned.domText.indexOf('37/100') >= 0,
    { kills: aligned.killsRow, elite: aligned.eliteRow, floor: aligned.floorRow, dom: aligned.domText.slice(0, 60) });

  // ---------- B4 不重复发放 ----------
  const repeat = await ev(`(() => {
    const r1 = __roamDebug.meta2.simulate('kills_100');
    const mid = __roamDebug.meta2.info().rewards;
    const r2 = __roamDebug.meta2.simulate('kills_100');
    const after = __roamDebug.meta2.info().rewards;
    const times = state.meta.achievements['kills_100'];
    return { r1: r1.unlocked, mid: mid, r2: r2.unlocked, after: after, time: times };
  })()`);
  check('B4 已达成成就再次 simulate 不重复发奖',
    repeat.r1.indexOf('kills_100') >= 0
    && repeat.mid.aether === repeat.after.aether && repeat.mid.cards === repeat.after.cards
    && repeat.r2.length === 0 && repeat.time > 1,
    repeat);

  // ---------- B5 奖励下一局生效 ----------
  const nextRun = await ev(`(() => {
    // 先把"首次通关"也拿下，确保 card 奖励在档
    __roamDebug.meta2.simulate('first_win');
    saveMeta();
    const reward = Number(state.meta.rewards.aether) || 0;
    const base = GAME_CONFIG.baseAether;
    restartRun();
    return {
      expect: base + reward, base: base,
      aetherMax: state.player.aetherMax,
      owned: state.ownedMagic.slice(0),
      slots: state.dual.slots.slice(0),
      cards: Number(state.meta.rewards.cards) || 0,
      saved: Number(loadMeta().rewards && loadMeta().rewards.aether) || 0
    };
  })()`);
  check('B5 奖励入档并在新一局真实生效（奥能上限提高 + 起手多一张冰环）',
    nextRun.aetherMax === nextRun.expect && nextRun.saved === nextRun.expect - nextRun.base
    && nextRun.owned.indexOf('frost') >= 0 && nextRun.cards === 1,
    nextRun);

  // ---------- B6 清档完全归零 ----------
  const wiped = await ev(`(() => {
    const r = __roamDebug.meta2.reset();
    const prog = __roamDebug.meta2.progress();
    // 楼层类成就在清档后仍有 1/target 的基线进度（新档从第 1 层起），这是预期口径
    const nonZero = prog.rows.filter((x) => x.pct > 0);
    return {
      stats: r.stats, rewards: r.rewards, peaks: r.peaks, ach: r.achievements.length,
      nonZero: nonZero.map((x) => ({ id: x.id, value: x.value, target: x.target, pct: x.pct })),
      badBaseline: nonZero.filter((x) => x.value !== 1 || x.id.indexOf('floor_') < 0).map((x) => x.id),
      doneRows: prog.rows.filter((x) => x.done).length,
      achText: prog.achText
    };
  })()`);
  check('B6 清档完全归零（统计 / 峰值 / 成就 / 奖励归零，进度条只剩楼层基线的 1/target）',
    wiped.stats.kills === 0 && wiped.stats.deaths === 0 && wiped.stats.eliteKills === 0
    && wiped.stats.bossKills === 0 && wiped.stats.flawlessFloors === 0 && wiped.stats.hiddenRooms === 0
    && wiped.stats.voidRifts === 0 && wiped.stats.singleSchoolClears === 0
    && wiped.peaks.bestCombo === 0 && wiped.peaks.bestRunRecipes === 0
    && wiped.ach === 0 && wiped.rewards.aether === 0 && wiped.rewards.cards === 0
    && wiped.doneRows === 0 && wiped.badBaseline.length === 0
    && wiped.achText === '成就 0 / ' + achList.length,
    wiped);

  // ---------- B7 达标行置灰 + 日期 ----------
  const gray = await ev(`(() => {
    ['first_kill', 'floor_3', 'blueprint_1'].forEach((id) => __roamDebug.meta2.simulate(id));
    const prog = __roamDebug.meta2.progress();
    const rows = prog.rows.filter((r) => r.done);
    const cls = document.querySelector('.archive-ach-row[data-id="first_kill"]').className;
    return { done: rows.map((r) => ({ id: r.id, date: r.date, pct: r.pct })), cls: cls };
  })()`);
  check('B7 达成行置灰并标日期（class 含 is-done、日期非空、进度 100%）',
    gray.done.length === 3 && gray.done.every((r) => r.date && r.pct === 100)
    && gray.cls.indexOf('is-done') >= 0,
    gray);

  // ---------- B8 真实钩子 ----------
  await ev('__roamDebug.meta2.reset()');
  const hooks = await ev(`(() => {
    __roamDebug.xp.setEnabled(false);
    __roamDebug.enemies.floor(1);
    state.mode = 'playing'; state.status = 'playing';
    const room = state.rooms.filter((r) => r.type === 'elite')[0] || state.rooms.find((r) => r.type !== 'start');
    state.currentRoomId = room.id;
    __roamDebug.teleport(room.cx, room.cy);
    __roamDebug.despawnAll();
    const type = Object.keys(ENEMY_CONFIG)[0];
    __roamDebug.spawnEnemyAt(type, room.cx + 60, room.cy, { roomId: room.id, elite: true });
    __roamDebug.pinEnemies(0);
    state.player.invuln = 999;
    const before = __roamDebug.meta2.info();
    const wasElite = !!state.enemies[0].elite;
    // 按"实际调用 killEnemy 的次数"对账：分裂/召唤类敌人会追加子体，
    // 用固定 +1 会误判；这里要求"每次真实击杀恰好记 1 次"，强度不降。
    let calls = 0;
    while (state.enemies.length && calls < 60) { killEnemy(state.enemies[0]); calls += 1; }
    const after = __roamDebug.meta2.info();
    return { before: before.stats, after: after.stats, peaks: after.peaks, type: type,
      isElite: wasElite, calls: calls };
  })()`);
  check('B8 真实 killEnemy 钩子累加精英击杀与连击峰值',
    hooks.after.kills === hooks.before.kills + hooks.calls
    && (!hooks.isElite || hooks.after.eliteKills === hooks.before.eliteKills + 1)
    && hooks.peaks.bestCombo >= 1,
    hooks);

  // ---------- B9 截图 ----------
  await ev(`(() => {
    __roamDebug.meta2.reset();
    __roamDebug.meta2.bump('kills', 37);
    __roamDebug.meta2.bump('eliteKills', 12);
    __roamDebug.meta2.bump('bossKills', 2);
    state.meta.bestFloor = 4;
    togglePanel('settings');
    renderArchivePanel();
    const sec = document.getElementById('archiveSection');
    if (sec) sec.scrollIntoView({ block: 'start' });
    return true;
  })()`);
  await sleep(420);
  await shot('meta20-before.png');
  await ev(`(() => {
    META_PROGRESS_CONFIG.achievements.forEach((a) => __roamDebug.meta2.simulate(a.id));
    renderArchivePanel();
    const sec = document.getElementById('archiveSection');
    if (sec) sec.scrollIntoView({ block: 'start' });
    return true;
  })()`);
  await sleep(420);
  await shot('meta20-after.png');

  fs.writeFileSync(RESULTS, JSON.stringify({
    at: new Date().toISOString(), cfg, checks,
    screenshots: ['meta20-before.png', 'meta20-after.png'], runtimeErrors
  }, null, 2));
  const fails = checks.filter((c) => !c.ok);
  console.log(`\nRESULT: ${fails.length ? 'FAIL' : 'PASS'}  ${checks.length - fails.length}/${checks.length}`);
  if (runtimeErrors.length) console.log('RUNTIME ERRORS: ' + JSON.stringify(runtimeErrors.slice(0, 3)));
  await cleanup();
  process.exit(fails.length ? 1 : 0);
}

/**
 * 关闭 Edge 与测试 profile
 * @returns {Promise<void>}
 */
async function cleanup() {
  try { if (EDGE_PROC) EDGE_PROC.kill(); } catch (e) { /* 已退出 */ }
  await sleep(300);
  try { killEdge(); } catch (e) { /* 忽略 */ }
}

main().catch(async (err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  await cleanup();
  process.exit(1);
});
