/* ============================================================================
 * 实机数值校验（C1-11 · 2026-11-08）
 * ----------------------------------------------------------------------------
 * 目的：验证「模拟器 → 主文件」三项调参真的在实机运行态生效，而不是只改了配置：
 *   1) BOSS_CONFIG.damageScale = 0.9（首领伤害 −10%）
 *   2) ENEMY_BUDGET_CONFIG.globalHpMul = 0.9（非首领怪血量 −10%）
 *   3) DEEP_HEAL_CONFIG 四类回血比例 +10%（0.165 / 0.055 / 0.044 / 0.198）
 * 同时打印逐层首领血量，验证 3200 硬上限"从 F1 就被压平"这一结论。
 *
 * 用法：node tools/_balance_check.js
 * ============================================================================ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9761;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* 降负载纪律：句柄提到 try 外层，保证异常路径也能在 finally 里关掉 Edge */
  let edge = null;
  let ws = null;
  try {
  const profile = prepareProfile();
  edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--allow-file-access-from-files',
    '--window-size=1600,1000',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (error) { /* 端口还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const fn = pending.get(m.id);
      pending.delete(m.id);
      fn(m);
    }
  };
  await new Promise((r) => { ws.onopen = r; });

  /**
   * 发送一个 CDP 指令并等待结果
   * @param {string} method 方法名
   * @param {Object} params 参数
   * @returns {Promise<Object>} result
   */
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2600);

  /**
   * 在页面上下文里求值（字符串表达式，失败抛出异常详情）
   * @param {string} expression 表达式
   * @returns {Promise<any>} 结果
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  // 进入一局，保证 state / 各类运行态已初始化
  await ev('document.getElementById("btnStart").click(); true');
  await sleep(900);

  const constants = await ev('({ damageScale: BOSS_CONFIG.damageScale, globalHpMul: ENEMY_BUDGET_CONFIG.globalHpMul, entry: DEEP_HEAL_CONFIG.entryRatio, clear: DEEP_HEAL_CONFIG.clearRatio, elite: DEEP_HEAL_CONFIG.eliteKillRatio, pulse: DEEP_HEAL_CONFIG.bossPulse.ratio, hpCap: BOSS_CONFIG.hpCap })');
  console.log('常量', JSON.stringify(constants));

  const bossRows = await ev('(function(){ var out=[]; for (var f=1; f<=20; f++) { var s=bossStatsForFloor(f); out.push(f+":"+s.hp+"/"+s.damage); } return out.join("  "); })()');
  console.log('首领 F1–F20（血量/伤害）', bossRows);

  // 实机刷怪：先按 1.0 刷一只，再按 0.9 刷一只，比较 hpMax 比值
  const spawnCheck = await ev([
    '(function(){',
    '  var saved = ENEMY_BUDGET_CONFIG.globalHpMul;',
    '  var x = state.player.x + 40, y = state.player.y;',
    '  ENEMY_BUDGET_CONFIG.globalHpMul = 1;',
    '  var a = spawnEnemy("patrol", x, y, state.floor, {});',
    '  var hpA = a.hpMax;',
    '  ENEMY_BUDGET_CONFIG.globalHpMul = saved;',
    '  var b = spawnEnemy("patrol", x, y + 30, state.floor, {});',
    '  var hpB = b.hpMax;',
    '  state.enemies = state.enemies.filter(function(e){ return e.id !== a.id && e.id !== b.id; });',
    '  return { hpMul1: hpA, hpMul09: hpB, ratio: hpB / hpA, floor: state.floor };',
    '})()'
  ].join(''));
  console.log('刷怪血量对照', JSON.stringify(spawnCheck));

  // 回血接口实测：直接把血打到 50%，再触发一次 entry 回复
  const healCheck = await ev([
    '(function(){',
    '  var before = state.player.hp;',
    '  state.player.hp = Math.round(state.player.hpMax * 0.5);',
    '  var healed = applyDeepHeal("entry", null, null, "校验");',
    '  var ratio = healed / state.player.hpMax;',
    '  state.player.hp = before;',
    '  return { healed: healed, hpMax: state.player.hpMax, ratio: Math.round(ratio * 1000) / 1000 };',
    '})()'
  ].join(''));
  console.log('回血实测', JSON.stringify(healCheck));

  } finally {
    /* 无论正常结束还是抛错，都关掉本脚本启动的无头 Edge，不靠进程自己退 */
    try { if (ws) ws.close(); } catch (e) { /* 已关闭 */ }
    try { if (edge) killEdge(edge); } catch (e) { /* 已退出 */ }
  }
})().catch((err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  process.exit(1);
});
