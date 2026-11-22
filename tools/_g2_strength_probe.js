/**
 * 第二组·逐层强度 / 数量实测探针（只读）
 * ------------------------------------------------------------
 * 回答三件事：进场怪数量、同屏上限、单只血量与伤害、精英房数量。
 * 做法：无头 Edge 加载主文件 → __roamDebug.enemies.floor(f) 真实掷层 ROLLS 次
 *       → 统计 F1/F3/F6/F12 战斗房与精英房的：总怪、首波、排队、单只血/伤/速、精英体数。
 * 只读，不改配置、不写存档。
 * 用法：
 *   node tools\_g2_strength_probe.js [--file=index_arcane_v2.html] [--rolls=15] [--floors=1,3,6,12]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9791;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'g2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析命令行参数
 * @returns {{file:string,out:string,rolls:number,floors:number[]}} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const pick = (k) => {
    const hit = a.find((x) => x.startsWith('--' + k + '='));
    return hit ? hit.slice(k.length + 3) : null;
  };
  return {
    file: path.resolve(pick('file') || path.join(ROOT, 'index_arcane_v2.html')),
    out: path.resolve(pick('out') || path.join(OUT_DIR, 'strength.json')),
    rolls: Number(pick('rolls') || 15),
    floors: (pick('floors') || '1,3,6,12').split(',').map(Number)
  };
}

/**
 * 启动无头 Edge 并连 CDP，加载被测 HTML
 * @param {string} file 被测文件绝对路径
 * @returns {Promise<{ev:Function,close:Function}>} 探针句柄
 */
async function boot(file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }

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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    await sleep(250);
    try {
      if (await ev(`typeof state !== 'undefined' && typeof __roamDebug === 'object'`)) break;
    } catch (e) { /* 仍在解析 */ }
  }
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, close };
}

/**
 * 页面内脚本：按层掷房并汇总数量 / 血量 / 伤害 / 精英
 * @param {number[]} floors 楼层
 * @param {number} rolls 每层掷房次数
 * @returns {string} Runtime.evaluate 表达式
 */
const PAGE_SCRIPT = (floors, rolls) => `(function(){
  var FLOORS = ${JSON.stringify(floors)};
  var ROLLS = ${rolls};
  state.seedInfo = { active: true, value: '261108', daily: false, custom: true, startedAt: 0 };
  if (typeof __rngOverride !== 'undefined') __rngOverride = null;
  try { __roamDebug.enemies.setAdaptive(false); } catch (e) { /* 老版本无此开关 */ }

  /** 平均值（空数组返回 null） */
  function avg(list) { return list.length ? list.reduce(function (s, v) { return s + v; }, 0) / list.length : null; }
  /** 保留 1 位 */
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  /** 保留 2 位 */
  function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }

  var out = [];
  FLOORS.forEach(function (f) {
    var cap = (typeof DENSITY_CONFIG !== 'undefined') ? DENSITY_CONFIG.aliveCap : null;
    var battle = [], eliteRooms = [], sampleBattle = null, sampleElite = null;
    for (var roll = 0; roll < ROLLS; roll += 1) {
      __roamDebug.enemies.floor(f);
      (state.rooms || []).forEach(function (room) {
        if (room.type !== 'battle' && room.type !== 'elite') return;
        if (!(room.enemyCount > 0)) return;
        var foes = (state.enemies || []).filter(function (e) { return e.roomId === room.id; });
        var pend = (room.wavePending || []);
        var normals = foes.filter(function (e) { return !e.elite; });
        var elites = foes.filter(function (e) { return !!e.elite; });
        var sumHp = function (arr) { return arr.reduce(function (s, e) { return s + Math.max(0, e.hpMax || 0) + Math.max(0, e.shieldHpMax || 0); }, 0); };
        var hpAll = sumHp(foes);
        var rec = {
          n: room.enemyCount,
          first: foes.length,
          pending: pend.length,
          waveBatch: room.waveBatchSize || null,
          chunk: room.waveChunk || null,
          hpSum: Math.round(hpAll),
          hpAvg: foes.length ? Math.round(hpAll / foes.length) : 0,
          hpMin: foes.length ? Math.min.apply(null, foes.map(function (e) { return e.hpMax; })) : 0,
          hpMax: foes.length ? Math.max.apply(null, foes.map(function (e) { return e.hpMax; })) : 0,
          normalHpAvg: normals.length ? Math.round(sumHp(normals) / normals.length) : 0,
          normalN: normals.length,
          eliteN: elites.length + pend.filter(function (q) { return q.opts && q.opts.elite; }).length,
          eliteHpAvg: elites.length ? Math.round(sumHp(elites) / elites.length) : 0,
          dmgAvg: r1(avg(foes.map(function (e) { return e.damage || 0; }))),
          dmgMin: foes.length ? Math.min.apply(null, foes.map(function (e) { return e.damage || 0; })) : 0,
          dmgMax: foes.length ? Math.max.apply(null, foes.map(function (e) { return e.damage || 0; })) : 0,
          spdAvg: r1(avg(foes.map(function (e) { return e.speed || 0; }))),
          eliteDmgAvg: r1(avg(elites.map(function (e) { return e.damage || 0; }))),
          alivePeak: room.alivePeak || 0
        };
        if (room.type === 'battle') {
          battle.push(rec);
          if (roll === 0 && !sampleBattle) sampleBattle = battle.slice(0, 3);
        } else {
          eliteRooms.push(rec);
          if (roll === 0 && !sampleElite) sampleElite = eliteRooms.slice(0, 2);
        }
      });
    }
    /* 跨房汇总：逐项平均，nil 安全 */
    var agg = function (list) {
      if (!list.length) return null;
      return {
        rooms: list.length,
        n: r1(avg(list.map(function (x) { return x.n; }))),
        first: r1(avg(list.map(function (x) { return x.first; }))),
        firstRange: [Math.min.apply(null, list.map(function (x) { return x.first; })), Math.max.apply(null, list.map(function (x) { return x.first; }))],
        pending: r1(avg(list.map(function (x) { return x.pending; }))),
        hpSum: Math.round(avg(list.map(function (x) { return x.hpSum; })) || 0),
        hpAvg: Math.round(avg(list.map(function (x) { return x.hpAvg; })) || 0),
        normalHpAvg: Math.round(avg(list.map(function (x) { return x.normalHpAvg; })) || 0),
        eliteN: r1(avg(list.map(function (x) { return x.eliteN; })) || 0),
        eliteHpAvg: Math.round(avg(list.map(function (x) { return x.eliteHpAvg; })) || 0),
        dmgAvg: r1(avg(list.map(function (x) { return x.dmgAvg; }))),
        dmgMin: Math.min.apply(null, list.map(function (x) { return x.dmgMin; })),
        dmgMax: Math.max.apply(null, list.map(function (x) { return x.dmgMax; })),
        spdAvg: r1(avg(list.map(function (x) { return x.spdAvg; }))),
        eliteDmgAvg: r1(avg(list.filter(function (x) { return x.eliteN > 0; }).map(function (x) { return x.eliteDmgAvg; }).filter(function (v) { return v != null; }))),
        alivePeak: Math.round(avg(list.map(function (x) { return x.alivePeak; })) || 0)
      };
    };
    var powerN = enemyFloorPowerOf(f, false);
    var powerE = enemyFloorPowerOf(f, true);
    out.push({
      floor: f,
      aliveCap: cap,
      power: { dmg: r2(powerN.damage), spd: r2(powerN.speed), rate: r2(powerN.rate || 1) },
      elitePower: { dmg: r2(powerE.damage), spd: r2(powerE.speed), rate: r2(powerE.rate || 1) },
      hpScale: r2(rampHpScale(f)),
      globalHpMul: (typeof ENEMY_BUDGET_CONFIG !== 'undefined') ? ENEMY_BUDGET_CONFIG.globalHpMul : null,
      playerHpMax: (state.player && state.player.hpMax) || null,
      battle: agg(battle),
      elite: agg(eliteRooms),
      samples: { battle: sampleBattle || [], elite: sampleElite || [] }
    });
  });
  return out;
})()`;

/**
 * 主流程：起浏览器 → 掷层采样 → 打印数字表并落盘
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs();
  const h = await boot(args.file);
  let rows = null;
  try {
    rows = await h.ev(PAGE_SCRIPT(args.floors, args.rolls));
  } finally {
    h.close();
  }
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(rows, null, 2), 'utf8');

  console.log('== 逐层强度 / 数量 ==');
  rows.forEach((r) => {
    const b = r.battle || {};
    const e = r.elite || {};
    console.log(`F${r.floor} | 同屏上限 ${r.aliveCap} | 压力 dmg×${r.power.dmg} spd×${r.power.spd} rate×${r.power.rate} | hpScale ${r.hpScale} | 玩家血 ${r.playerHpMax}`);
    if (r.battle) console.log(`  战斗房 ${b.rooms} 间/层 | 总怪 ${b.n} | 首波 ${b.first} (${b.firstRange.join('–')}) | 排队 ${b.pending} | 单只血 ${b.normalHpAvg} | 首波总血 ${b.hpSum} | 伤害 ${b.dmgAvg} (${b.dmgMin}–${b.dmgMax}) | 速度 ${b.spdAvg}`);
    if (r.elite) console.log(`  精英房 ${e.rooms} 间/层 | 总怪 ${e.n} | 首波 ${e.first} (${e.firstRange.join('–')}) | 精英体 ${e.eliteN} 只 | 精英血 ${e.eliteHpAvg} | 精英伤害 ${e.eliteDmgAvg}`);
  });
  console.log('已写入 ' + args.out);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
