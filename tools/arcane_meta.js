/**
 * 第 5 轮 · 第 4 组验收：档案 / 成就（元进度）
 * ------------------------------------------------------------
 * 覆盖：
 *   D0 配置与口径（成就表数量、奖励上限、起手卡 id 合法）
 *   D1 真实击杀 / 死亡累加统计，跨局不丢（restartRun 后仍在）
 *   D2 成就只发一次（第二次结算不再加奖励）
 *   D3 奖励写进存档且下一局真实生效（初始奥能上限 +N）
 *   D4 起手多一张卡（通关奖励 → 新局卡组与副槽真的有冰环）
 *   D5 清档能重置（统计 / 成就 / 奖励全归零，下一局回到基线）
 *   D6 面板入口在现有菜单内（档案区块属于设置面板，不在常驻 UI）
 *   D7 before / after 截图各 1 张 + 成就提示 1 张（共 3 张）
 *
 * 用法：node tools/arcane_meta.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9766;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'meta');
const RESULTS = path.join(OUT, 'meta-result.json');

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
    } catch (e) { /* 端口还没起 */ }
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

  // ---------- D0 配置 ----------
  const cfg = await ev('__roamDebug.meta2.config()');
  const frostOk = await ev('typeof MAGIC_BY_ID !== "undefined" && !!MAGIC_BY_ID["frost"]');
  check('D0 配置：成就扩充到 20 条左右 + 奖励上限 + 起手卡 id 合法',
    cfg.count >= 20 && cfg.maxAetherReward >= 1 && cfg.maxCardReward === 1 && cfg.extraCardMagic === 'frost' && frostOk === true,
    { count: cfg.count, maxAether: cfg.maxAetherReward, maxCards: cfg.maxCardReward, card: cfg.extraCardMagic, frostOk: frostOk });

  // 从干净存档开始
  const base = await ev('__roamDebug.meta2.reset()');
  check('D0b 清档后基线归零', base.stats.kills === 0 && base.stats.deaths === 0
    && base.rewards.aether === 0 && base.rewards.cards === 0 && base.achievements.length === 0,
  { stats: base.stats, rewards: base.rewards, achievements: base.achievements });

  /**
   * 布置：一层大房间 + N 只站桩怪（关经验弹窗，避免打断）
   * @param {number} n 敌人数
   * @returns {Promise<Object>} 房间信息
   */
  const setup = (n) => ev(`(() => {
    __roamDebug.xp.setEnabled(false);
    __roamDebug.enemies.floor(1);
    state.mode = 'playing'; state.status = 'playing';
    const room = state.rooms.filter((r) => r.type === 'battle' || r.type === 'elite')
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || state.rooms[0];
    state.currentRoomId = room.id;
    __roamDebug.teleport(room.cx, room.cy);
    __roamDebug.despawnAll();
    const type = Object.keys(ENEMY_CONFIG)[0];
    for (let i = 0; i < ${n}; i += 1) {
      const a = (Math.PI * 2 / ${n}) * i;
      __roamDebug.spawnEnemyAt(type, room.cx + Math.cos(a) * 120, room.cy + Math.sin(a) * 120, { roomId: room.id });
    }
    __roamDebug.pinEnemies(0);
    state.player.invuln = 999;
    return { foes: state.enemies.length, type: type };
  })()`);

  // ---------- D1 真实击杀累加 + 跨局保留 ----------
  const before1 = await ev('__roamDebug.meta2.info()');
  const runKills = await ev(`(() => {
    const killed = state.enemies.length;
    const runBefore = state.kills;
    while (state.enemies.length) killEnemy(state.enemies[0]);
    saveMeta();
    // 分裂/召唤怪会在死亡时再生成子体，所以用"局内击杀计数器增量"作为真值，而不是初始队列长度
    return { killed: killed, delta: state.kills - runBefore, runKills: state.kills };
  })()`);
  const after1 = await ev('__roamDebug.meta2.info()');
  check('D1a 真实 killEnemy 路径让累计击杀 +N（与局内击杀计数器增量一致）',
    after1.stats.kills === before1.stats.kills + runKills.delta && runKills.delta >= 3 && runKills.killed >= 3,
    { before: before1.stats.kills, after: after1.stats.kills, killed: runKills.killed, delta: runKills.delta });
  check('D1b 统计已落盘（localStorage 读到同样的值）',
    after1.saved.kills === after1.stats.kills,
    { saved: after1.saved.kills, mem: after1.stats.kills });

  // 真实死亡路径：loseGame 会 +1 死亡次数
  const deathBefore = (await ev('__roamDebug.meta2.info()')).stats.deaths;
  await ev(`(() => { state.status = 'playing'; state.mode = 'playing'; state.player.hp = 0; loseGame(state.player.x, state.player.y); return true; })()`);
  const deathAfter = (await ev('__roamDebug.meta2.info()')).stats.deaths;
  check('D1c 真实 loseGame 路径让死亡次数 +1', deathAfter === deathBefore + 1,
    { before: deathBefore, after: deathAfter });

  // 跨局：restartRun 之后累计值不丢、本局计数归零
  const crossRun = await ev(`(() => {
    restartRun();
    return { metaKills: __roamDebug.meta2.info().stats.kills, runKills: state.kills, deaths: __roamDebug.meta2.info().stats.deaths };
  })()`);
  check('D1d 跨局累积正确：重开后累计保留、局内归零',
    crossRun.metaKills === after1.stats.kills && crossRun.runKills === 0 && crossRun.deaths === deathAfter,
    crossRun);

  // ---------- D2 成就只发一次 ----------
  const aetherBefore = (await ev('__roamDebug.meta2.info()')).rewards.aether;
  await ev('__roamDebug.meta2.bump("kills", 100)');
  await ev('state.meta.bestFloor = 5; state.meta.clears = 1; state.meta.bossBlueprints = ["bp_overload"];');
  const firstCheck = await ev('__roamDebug.meta2.check(true)');
  const afterCheck = await ev('__roamDebug.meta2.info()');
  const secondCheck = await ev('__roamDebug.meta2.check(true)');
  const afterSecond = await ev('__roamDebug.meta2.info()');
  check('D2a 达标成就一次结算', firstCheck.unlocked.length >= 3,
    { unlocked: firstCheck.unlocked });
  check('D2b 第二次结算不再发奖（只发一次）',
    secondCheck.unlocked.length === 0
    && afterSecond.rewards.aether === afterCheck.rewards.aether
    && afterSecond.rewards.cards === afterCheck.rewards.cards,
  { secondUnlocked: secondCheck.unlocked, rewards1: afterCheck.rewards, rewards2: afterSecond.rewards });

  // ---------- D3 奖励影响下一局 ----------
  const baselineAether = await ev('GAME_CONFIG.baseAether');
  const expectAether = await ev(`(() => GAME_CONFIG.baseAether
    + (Number(state.meta.talents && state.meta.talents.aether) || 0) * 10
    + (Number(state.meta.rewards && state.meta.rewards.aether) || 0))()`);
  const runAether = await ev('state.player.aetherMax');
  check('D3a 奖励已即时作用到当前局（上限提高）',
    runAether === expectAether && afterSecond.rewards.aether > aetherBefore,
    { aetherMax: runAether, expect: expectAether, reward: afterSecond.rewards.aether, before: aetherBefore });

  const nextRun = await ev(`(() => {
    restartRun();
    return {
      aetherMax: state.player.aetherMax,
      reward: Number(state.meta.rewards && state.meta.rewards.aether) || 0,
      base: GAME_CONFIG.baseAether,
      savedReward: Number(loadMeta().rewards && loadMeta().rewards.aether) || 0
    };
  })()`);
  check('D3b 下一局开局上限真实更高（存档 → 新局生效）',
    nextRun.aetherMax === nextRun.base + nextRun.reward && nextRun.reward >= 3 && nextRun.savedReward === nextRun.reward,
    nextRun);

  // ---------- D4 起手多一张卡 ----------
  const cardsBefore = (await ev('__roamDebug.meta2.info()')).rewards.cards;
  check('D4a 通关成就解锁后 rewards.cards = 1', cardsBefore === 1, { cards: cardsBefore });
  const cardRun = await ev(`(() => {
    restartRun();
    return {
      owned: state.ownedMagic.slice(0),
      slots: state.dual.slots.slice(0),
      cards: Number(state.meta.rewards && state.meta.rewards.cards) || 0
    };
  })()`);
  check('D4b 新局卡组真的多一张卡（冰环 + 副槽）',
    cardRun.owned.indexOf('frost') >= 0 && cardRun.slots[1] === 'frost' && cardRun.cards === 1,
    cardRun);

  // ---------- D5 清档能重置 ----------
  const wiped = await ev('__roamDebug.meta2.reset()');
  check('D5a 清档后统计 / 成就 / 奖励 / 配方全归零',
    wiped.stats.kills === 0 && wiped.stats.deaths === 0
    && wiped.achievements.length === 0 && wiped.rewards.aether === 0 && wiped.rewards.cards === 0
    && wiped.recipes.length === 0,
  { stats: wiped.stats, ach: wiped.achievements, rewards: wiped.rewards, recipes: wiped.recipes });

  const wipedRun = await ev(`(() => {
    restartRun();
    return { aetherMax: state.player.aetherMax, owned: state.ownedMagic.slice(0), slot1: state.dual.slots[1] };
  })()`);
  check('D5b 清档后新局回到基线（无加成 / 无额外卡）',
    wipedRun.aetherMax === baselineAether && wipedRun.owned.length === 1 && wipedRun.slot1 === null,
    wipedRun);

  // ---------- D6 面板入口在现有菜单内 ----------
  const panel = await ev(`(() => {
    const sec = document.getElementById('archiveSection');
    const inSettings = sec && sec.closest('.settings-panel') !== null;
    const layer = document.getElementById('settingsPanel');
    const hiddenNow = layer ? (layer.getAttribute('aria-hidden') === 'true' && !layer.classList.contains('is-open')) : null;
    return { inSettings: inSettings, settingsHiddenDuringPlay: hiddenNow };
  })()`);
  check('D6a 档案区块属于设置面板，战斗时不可见（非常驻 UI）',
    panel.inSettings === true && panel.settingsHiddenDuringPlay === true, panel);

  await ev(`(() => {
    __roamDebug.meta2.bump('kills', 7);
    __roamDebug.meta2.bump('deaths', 2);
    state.meta.bestFloor = 3;
    togglePanel('settings');
    const sec = document.getElementById('archiveSection');
    if (sec) sec.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(400);
  const rendered = await ev('__roamDebug.meta2.render()');
  const infoNow = await ev('__roamDebug.meta2.info()');
  check('D6b 面板显示的数字与存档口径一致',
    rendered.kills === String(infoNow.stats.kills)
    && rendered.deaths === String(infoNow.stats.deaths)
    && rendered.bestFloor === String(infoNow.metrics.bestFloor)
    && rendered.rows >= 20,
  { panel: rendered, info: infoNow.stats });

  // ---------- D7 截图 ----------
  await ev(`(() => { document.getElementById('archiveSection').style.visibility = 'hidden'; return true; })()`);
  await sleep(200);
  await shot('archive-before.png');
  await ev(`(() => { document.getElementById('archiveSection').style.visibility = ''; return true; })()`);
  await sleep(240);
  await shot('archive-after.png');

  // 成就提示：把击杀补齐到 100，触发一次真实解锁弹提示
  await ev(`(() => { togglePanel('settings'); __roamDebug.meta2.bump('kills', 100); return true; })()`);
  await sleep(300);
  await ev('__roamDebug.meta2.check(false)');
  await sleep(260);
  await shot('archive-toast.png');

  // ---------- 汇总 ----------
  const failed = checks.filter((c) => !c.ok);
  const summary = {
    round: 5, group: 4, at: new Date().toISOString(),
    checks, pass: checks.filter((c) => c.ok).length, total: checks.length,
    runtimeErrors,
    config: cfg,
    samples: { afterKills: after1, crossRun, nextRun, cardRun, wiped, panel: rendered }
  };
  fs.writeFileSync(RESULTS, JSON.stringify(summary, null, 2));
  console.log(`\nRESULT: ${failed.length === 0 ? 'PASS' : 'FAIL'}  ${summary.pass}/${summary.total}`);
  if (runtimeErrors.length) {
    console.log('运行时异常：');
    runtimeErrors.slice(0, 5).forEach((e) => console.log('  ' + e));
  }
  ws.close();
  if (EDGE_PROC) { try { EDGE_PROC.kill(); } catch (e) { /* 已退出 */ } }
  process.exit(failed.length === 0 && runtimeErrors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  if (EDGE_PROC) { try { EDGE_PROC.kill(); } catch (e) { /* 已退出 */ } }
  process.exit(2);
});
