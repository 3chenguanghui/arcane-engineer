/**
 * 节奏诊断探针（只读，不改主文件）
 * ----------------------------------------------------------------------------
 * 目的：用主文件真实的 generateFloor / spawnEnemiesForFloor 做逐层实测，
 *      回答"到 boss 前共几关 / 每关刷多少怪 / 到 boss 前最多升几级"。
 *
 * 口径：
 *   · 每次循环 = 一局；一局按 F1→F5 依次调用 __roamDebug.enemies.floor(n)，
 *     该函数内部就是 state.floor=n + generateFloor(n)，即真实生成 + 真实刷怪。
 *   · 等级由主文件自己的 xpNeedFor() 递推，经验来自 XP_CONFIG.killXp
 *     （普通 10 / 精英 35 / 首领 120），不另写一套曲线。
 *   · 生存房的持续刷波不计入（生成时 0 只），在结果里单独标记。
 *
 * 用法：node tools/rhythm_probe.js [局数] [输出tag]
 * 产物：tools/rhythm_out/<tag>.json
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile', 'rhythm-' + Date.now());
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9750 + Math.floor(Math.random() * 200);
const ROOT = path.join(__dirname, '..');
const FILE = process.env.ARCANE_FILE || path.join(ROOT, 'index_arcane_v2.html');
const RUNS = Math.max(5, parseInt(process.argv[2], 10) || 60);
const TAG = process.argv[3] || 'before';
const OUT_DIR = path.join(ROOT, 'tools', 'rhythm_out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并通过 CDP 拿到 eval 能力
 * @returns {Promise<{send:Function, ev:Function, shot:Function, close:Function}>}
 */
async function connect() {
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
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
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
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };
  return { send, ev, shot, close: () => { try { edge.kill(); } catch (e) { /* ignore */ } } };
}

/**
 * 读取当前层结构（房型 + 每房敌人数 + 首领数据）
 * @param {Function} ev 求值函数
 * @returns {Promise<Object>} 单层快照
 */
function floorSnapshotExpr() {
  return `(() => {
    const rooms = state.rooms.map((r) => ({
      type: r.type,
      n: r.enemyCount != null ? r.enemyCount : 0,
      live: state.enemies.filter((e) => e.roomId === r.id).length,
      types: r.enemyTypes ? r.enemyTypes.slice() : []
    }));
    const boss = state.boss ? {
      id: state.boss.kind || state.boss.id || null,
      hp: Math.round(state.boss.hp || 0),
      maxHp: Math.round(state.boss.hpMax || state.boss.maxHp || 0)
    } : null;
    return {
      floor: state.floor,
      rooms,
      boss,
      totalEnemies: state.enemies.length
    };
  })()`;
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { send, ev, shot, close } = await connect();
  try {
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    for (let i = 0; i < 120; i += 1) {
      const ready = await ev('typeof startGame === "function"').catch(() => false);
      if (ready === true) break;
      await sleep(200);
    }
    // 跳过选角 → 直接开局（与既有探针一致）
    await ev(`(() => { window.__charSkipPick = true; window.__charPickedThisBoot = true;
      try { closeCharSelect(); } catch (e) {}
      const layer = document.getElementById('charLayer'); if (layer) layer.style.display = 'none';
      startGame(); return true; })()`);
    await sleep(700);
    await ev(`FLOOR_MOD_CONFIG.enabled = false; state.floorMod = null; true`);
    await ev(`__roamDebug.enemies.setAdaptive(false)`);

    const cfg = await ev(`({ killXp: XP_CONFIG.killXp, baseNeed: XP_CONFIG.baseNeed, growth: XP_CONFIG.growth,
      finalFloor: GAME_CONFIG.finalFloor, roomsPerFloor: FLOOR_STRUCTURE_CONFIG.roomsPerFloor })`);
    // 主文件自己的门槛递推：Lv.1..30
    const needs = await ev(`(() => { const a = []; for (let i = 1; i <= 30; i += 1) a.push(xpNeedFor(i)); return a; })()`);

    const runs = [];
    for (let runIdx = 0; runIdx < RUNS; runIdx += 1) {
      const perFloor = [];
      let xpTotal = 0;
      let level = 1;
      let xpResidual = 0;
      for (let f = 1; f <= 5; f += 1) {
        await ev(`__roamDebug.enemies.floor(${f})`);
        await sleep(120);
        const snap = await ev(floorSnapshotExpr());
        // 统计本层经验（不含首领）：普通房 10/只，精英房 35/只
        let floorXp = 0;
        const rooms = snap.rooms.map((r) => {
          let xp = 0;
          if (r.type === 'battle') xp = r.n * cfg.killXp.normal;
          else if (r.type === 'elite') xp = r.n * cfg.killXp.elite;
          floorXp += xp;
          return { type: r.type, n: r.n, first: r.live, xp };
        });
        // 把本层经验滚进等级（用主文件门槛，余量保留到下一层）
        xpResidual += floorXp;
        while (xpResidual >= needs[level - 1]) {
          xpResidual -= needs[level - 1];
          level += 1;
        }
        // 本层内容房清完、还没打首领时的等级
        let levelBeforeBoss = level;
        // F1–F4 的首领必须击杀才能下潜，经验要算进"到最终 boss 前"
        if (f < 5) {
          xpResidual += cfg.killXp.boss;
          xpTotal += cfg.killXp.boss;
          while (xpResidual >= needs[level - 1]) {
            xpResidual -= needs[level - 1];
            level += 1;
          }
          levelBeforeBoss = level;
        }
        perFloor.push({
          floor: f,
          rooms,
          battleRooms: rooms.filter((r) => r.type === 'battle').length,
          eliteRooms: rooms.filter((r) => r.type === 'elite').length,
          /* M2 台账：普通房/精英房各出多少只，用于与 sim 逐笔对账 */
          battleKills: rooms.filter((r) => r.type === 'battle').reduce((s, r) => s + r.n, 0),
          eliteKills: rooms.filter((r) => r.type === 'elite').reduce((s, r) => s + r.n, 0),
          enemies: rooms.reduce((s, r) => s + r.n, 0),
          floorXp,
          levelBeforeBoss,
          levelAfterClear: level,
          boss: snap.boss,
          hasSurvival: rooms.some((r) => r.type === 'survival')
        });
        xpTotal += floorXp;
        if (runIdx === 0 && f === 5) await shot('rhythm_' + TAG + '_f5.png');
      }
      const preBoss = perFloor.slice(0, 4).reduce((s, p) => s + p.enemies, 0)
        + perFloor[4].enemies;
      runs.push({
        perFloor,
        preBossEnemies: preBoss,
        preBossXp: xpTotal,
        levelBeforeFinalBoss: perFloor[4].levelBeforeBoss
      });
    }

    const summary = summarize(runs, cfg, needs);
    const out = { tag: TAG, file: FILE, runs: RUNS, cfg, needs: needs.slice(0, 15), summary, samples: runs.slice(0, 3) };
    fs.writeFileSync(path.join(OUT_DIR, TAG + '.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    close();
  }
}

/**
 * 汇总 N 局样本：关数 / 每关怪数 / 等级分布 / 经验曲线
 * @param {Array<Object>} runs 每局结果
 * @param {Object} cfg 经验配置
 * @param {Array<number>} needs 每级门槛
 * @returns {Object} 汇总
 */
function summarize(runs, cfg, needs) {
  const median = (arr) => {
    const a = arr.slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    return a[Math.floor(a.length / 2)];
  };
  const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const levels = runs.map((r) => r.levelBeforeFinalBoss);
  const dist = {};
  levels.forEach((lv) => { dist[lv] = (dist[lv] || 0) + 1; });
  const perFloor = [1, 2, 3, 4, 5].map((f) => {
    const rows = runs.map((r) => r.perFloor[f - 1]);
    return {
      floor: f,
      avgEnemies: +avg(rows.map((x) => x.enemies)).toFixed(2),
      minEnemies: Math.min(...rows.map((x) => x.enemies)),
      maxEnemies: Math.max(...rows.map((x) => x.enemies)),
      avgBattleRooms: +avg(rows.map((x) => x.battleRooms)).toFixed(2),
      avgEliteRooms: +avg(rows.map((x) => x.eliteRooms)).toFixed(2),
      avgFloorXp: +avg(rows.map((x) => x.floorXp)).toFixed(1),
      /* M2 台账：逐层普通房/精英房击杀数（经验 = 战×10 + 精×35） */
      avgBattleKills: +avg(rows.map((x) => x.battleKills)).toFixed(2),
      avgEliteKills: +avg(rows.map((x) => x.eliteKills)).toFixed(2),
      avgFirstWave: +avg(rows.map((x) => x.rooms
        .filter((r) => r.type === 'battle')
        .reduce((s, r) => s + (r.first || 0), 0))).toFixed(2),
      bossHpMedian: median(rows.map((x) => (x.boss ? x.boss.maxHp : 0))),
      survivalRooms: rows.filter((x) => x.hasSurvival).length
    };
  });
  const totalNeedToLevel = (lv) => needs.slice(0, lv - 1).reduce((s, v) => s + v, 0);
  return {
    runs: runs.length,
    floorsToBoss: 5,
    bossFloor: 5,
    avgPreBossEnemies: +avg(runs.map((r) => r.preBossEnemies)).toFixed(1),
    minPreBossEnemies: Math.min(...runs.map((r) => r.preBossEnemies)),
    maxPreBossEnemies: Math.max(...runs.map((r) => r.preBossEnemies)),
    avgPreBossXp: +avg(runs.map((r) => r.preBossXp)).toFixed(1),
    minPreBossXp: Math.min(...runs.map((r) => r.preBossXp)),
    maxPreBossXp: Math.max(...runs.map((r) => r.preBossXp)),
    avgLevelBeforeBoss: +avg(levels).toFixed(2),
    levelDist: dist,
    maxLevelObserved: Math.max(...levels),
    minLevelObserved: Math.min(...levels),
    xpToReachLv10: totalNeedToLevel(10),
    xpToReachLv15: totalNeedToLevel(15),
    perFloor
  };
}

run().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
