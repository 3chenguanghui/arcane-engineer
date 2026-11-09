/* ============================================================================
 * 成就/图鉴并入验收（C1-12 · 2026-11-08）
 * ----------------------------------------------------------------------------
 * 覆盖：
 *   P1 38 条成就全部可解锁（29 直接注册 + 8 补分支 + 1 新计数器）
 *   P2 reward.aether 合计 26 = maxAetherReward，不再出现"+0"
 *   P3 解锁 → 刷新页面（相当于退出重进）后成就不丢
 *   P4 图鉴术语页 6 条全可见；卡牌文案带风味句
 *   P5 零运行时报错
 * 用法：node tools/_ach_persist.js
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9757;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录断言
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
}

(async () => {
  /* 降负载纪律：句柄提到 try 外层，保证异常路径也能在 finally 里关掉 Edge */
  let edge = null;
  let ws = null;
  try {
  const profile = prepareProfile();
  edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  ws = new WebSocket(target.webSocketDebuggerUrl);
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
  const nav = async () => {
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(2000);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await nav();
  await ev('document.querySelector("#btnStart").click(); true');
  await sleep(900);

  /* 先清空本机测试档，保证从 0 开始（游戏重进后由 saveMeta 以 GAME_CONFIG.metaKey 写入） */
  await ev('localStorage.clear(); true');

  // ---------- P1 38 条全部解锁 ----------
  const all = await ev([
    '(function(){',
    '  window.__errors = [];',
    '  window.addEventListener("error", function(e){ window.__errors.push(String(e.message || e)); });',
    '  var m = state.meta;',
    '  m.stats.kills = 5000; m.stats.deaths = 5; m.stats.eliteKills = 200; m.stats.bossKills = 20;',
    '  m.stats.flawlessFloors = 5; m.stats.hiddenRooms = 1; m.stats.voidRifts = 1;',
    '  m.stats.singleSchoolClears = 3; m.stats.barrelKills = 20;',
    '  m.bestCombo = 50; m.bestFloor = 20; m.bestRunRecipes = 5; m.clears = 5;',
    '  m.recipes = FUSION_CONFIG.map(function(x){ return x.id; });',
    '  m.bossBlueprints = BOSS_BLUEPRINT_CONFIG.blueprints.map(function(x){ return x.id; });',
    '  m.eventStats.wagerWins = 3; m.eventStats.sacrifice = 5;',
    '  m.talents = { hp: 10, speed: 10, power: 10 };',
    '  m.challengeCleared = { "10": 3 };',
    '  m.seedRuns = { dailyA: { seed: "dailyA", daily: true, date: "2026-11-08", bestFloor: 20, bestTime: 60, deathCause: "", cleared: true, attempts: 1, lastAt: 1 } };',
    '  var eids = ENEMY_CONFIG.map(function(x){ return x.id; });',
    '  var cids = RELIC_CONFIG.slice(0,10).map(function(x){ return x.id; });',
    '  var kids = MAGIC_CONFIG.concat(TECH_CONFIG).map(function(x){ return x.id; });',
    '  m.codex.enemies = eids; m.codex.relics = cids; m.codex.cards = kids;',
    '  m.codex.recipes = FUSION_CONFIG.map(function(x){ return x.id; });',
    '  m.codex.blueprints = BOSS_BLUEPRINT_CONFIG.blueprints.map(function(x){ return x.id; });',
    '  var got = checkMetaAchievements(true);',
    '  saveMeta();',
    '  return { count: META_PROGRESS_CONFIG.achievements.length, unlocked: got.length,',
    '    done: Object.keys(m.achievements).length, aetherTotal: m.rewards.aether,',
    '    cap: META_PROGRESS_CONFIG.maxAetherReward,',
    '    missing: META_PROGRESS_CONFIG.achievements.filter(function(i){ return !m.achievements[i.id]; }).map(function(i){ return i.id; }),',
    '    eids: eids.length, kids: kids.length };',
    '})()'
  ].join(''));
  ok('P1 38 条成就全部可解锁', all.count === 38 && all.done === 38 && all.missing.length === 0,
    { config: all.count, unlockedNow: all.unlocked, done: all.done, missing: all.missing });
  ok('P2 奥能奖励合计 = 上限（不再有 +0）', all.aetherTotal === all.cap && all.cap === 26,
    { aetherTotal: all.aetherTotal, cap: all.cap });

  // ---------- P3 刷新页面（退出重进）后不丢 ----------
  await nav();
  await ev('document.querySelector("#btnStart").click(); true');
  await sleep(900);
  const after = await ev('({ done: Object.keys(state.meta.achievements || {}).length, aether: state.meta.rewards.aether, barrel: (state.meta.stats||{}).barrelKills })');
  ok('P3 解锁 → 刷新（退出重进）→ 成就与奖励不丢', after.done === 38 && after.aether === 26 && after.barrel === 20, after);

  // ---------- P4 图鉴术语与卡牌文案 ----------
  const codex = await ev([
    '(function(){',
    '  state.codexTab = "terms"; state.codexPage = 0; buildCodexPanel();',
    '  var termRows = document.querySelectorAll("#codexBody .codex-entry").length;',
    '  var termText = document.getElementById("codexProgress").textContent;',
    '  state.codexTab = "cards"; buildCodexPanel();',
    '  var entries = codexSourceEntries("cards");',
    '  var f = entries.filter(function(x){ return CODEX_FLAVOR[x.id] && x.desc.indexOf(CODEX_FLAVOR[x.id]) === 0; });',
    '  return { termRows: termRows, termText: termText, cards: entries.length, flavored: f.length };',
    '})()'
  ].join(''));
  ok('P4 术语 6 条全可见 + 卡牌 20 条带风味句',
    codex.termRows === 6 && codex.termText === '6 / 6' && codex.cards === 20 && codex.flavored === 20, codex);

  // ---------- P5 奖励已满时统一文案「已记入档案」（toast 与面板同口径） ----------
  const toast = await ev([
    '(function(){',
    '  var m = state.meta;',
    '  m.rewards.aether = META_PROGRESS_CONFIG.maxAetherReward;',
    '  var item = META_PROGRESS_CONFIG.achievements.filter(function(x){ return x.reward && x.reward.aether; })[0];',
    '  delete m.achievements[item.id];',
    '  var got = checkMetaAchievements(false);',
    '  var text = (document.getElementById("toast") || {}).textContent || "";',
    '  var row = document.querySelector("#archiveAchList .archive-ach-row[data-id=\\"" + item.id + "\\"]");',
    '  var panelText = row ? ((row.querySelector(".ach-reward") || {}).textContent || "") : "";',
    '  return { text: text, panelText: panelText, unlocked: got.map(function(x){ return x.id; }), item: item.id };',
    '})()'
  ].join(''));
  ok('P5 满额时 toast 与面板均显示「已记入档案」，不出现 +0 / 初始奥能已满',
    toast.text.indexOf('+0') < 0 && toast.text.indexOf('初始奥能已满') < 0
      && toast.text.indexOf('已记入档案') >= 0 && toast.panelText.indexOf('已记入档案') >= 0, toast);

  const errors = await ev('window.__errors.slice()');
  ok('P6 零运行时报错', errors.length === 0, errors);

  fs.writeFileSync(path.join(ROOT, '.screenshots', 'art', 'i-ach-persist-result.json'),
    JSON.stringify({ asserts, pass: asserts.filter((a) => a.pass).length, total: asserts.length }, null, 2));
  console.log('\nRESULT: ' + (asserts.every((a) => a.pass) ? 'PASS' : 'FAIL')
    + ' ' + asserts.filter((a) => a.pass).length + '/' + asserts.length);

  /* 清掉本轮测试档 */
  await ev('localStorage.clear(); true');
  } finally {
    /* 无论正常结束还是抛错，都关掉本脚本启动的无头 Edge，不靠进程自己退 */
    try { if (ws) ws.close(); } catch (err) { /* 已关闭 */ }
    try { if (edge) killEdge(edge); } catch (err) { /* 已退出 */ }
  }
})().catch((e) => {
  console.error('FATAL', e && e.stack ? e.stack : e);
  killEdge();
  process.exit(1);
});
