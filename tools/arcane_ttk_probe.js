/**
 * D3 实测探针：每只怪「出生 → 死亡」的 TTK 分布 + 同屏峰值 + 每房总时长
 * ------------------------------------------------------------
 * 用法：node tools/arcane_ttk_probe.js [输出文件名后缀]
 * 端口：9541
 * 输出：.screenshots/art/d3-ttk-<后缀>.json
 *
 * 口径（务必和报告里的数字一一对应）：
 *   ttk        = 出生 → 死亡（含排队/跑图，偏大）
 *   ttkCombat  = 第一次被打中 → 死亡（真正挨打的秒数，判断单只怪手感用这个）
 *   engage     = 出生 → 第一次被打中（接敌延迟）
 *   alivePeak  = 本房同屏存活峰值（spawnEnemy 里逐帧维护）
 *   roomClear  = 本房首次接敌 → 最后一只死亡（"这间房打了多久"）
 *
 * 采样：F1 / F5 / F20，每层取 2 间战斗房；站桩自动施法（火球冷却 0.55s），
 *       直接把玩家血量拉到 99999，避免中途死亡打断采样。
 *       这不是"人手操作"的证据，只回答一个问题：单只怪在当前数值下要挨多久。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9541;
const ROOT = path.join(__dirname, '..');
const FILE = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const TAG = process.argv[2] || 'run';
const FLOORS = (process.env.TTK_FLOORS || '1,5,20').split(',').map((x) => Number(x));
const ROOMS_PER_FLOOR = 2;
const DRIVE_SECONDS = Number(process.env.TTK_SECONDS || 30);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 取分位数（最近秩法，样本量小也不用插值）
 * @param {number[]} sorted 已升序排列的数组
 * @param {number} p 0–1
 * @returns {number|null} 分位值
 */
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[i];
}

/**
 * 汇总一组数值的 n / min / 中位 / max / 均值
 * @param {number[]} values 原始数值
 * @returns {Object} 统计快照
 */
function summarize(values) {
  const arr = values.filter((v) => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return { n: 0, min: null, median: null, max: null, mean: null };
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    n: arr.length,
    min: Math.round(arr[0] * 100) / 100,
    median: Math.round(quantile(arr, 0.5) * 100) / 100,
    p90: Math.round(quantile(arr, 0.9) * 100) / 100,
    max: Math.round(arr[arr.length - 1] * 100) / 100,
    mean: Math.round((sum / arr.length) * 100) / 100
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1280,720', 'about:blank'
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  // 等脚本就绪再开局：新档首局会先弹角色选择，startGame 返回 false，需要 chooseCharacter 补一刀
  for (let i = 0; i < 60; i += 1) {
    if (await ev(`typeof startGame === 'function'`)) break;
    await sleep(250);
  }
  await ev(`(function(){
    if (state.mode === 'title') {
      startGame();
      if (state.mode === 'title' && typeof chooseCharacter === 'function' && CHARACTER_CONFIG) {
        chooseCharacter(CHARACTER_CONFIG.ids[0]);
      }
    }
    return state.mode;
  })()`);
  for (let i = 0; i < 60; i += 1) {
    if ((await ev(`state.mode`)) === 'playing') break;
    await sleep(200);
  }
  // 挂个"不死"血量：只保护采样不被中途打断，不改任何怪物数值
  await ev(`(function(){ state.player.hpMax = 99999; state.player.hp = 99999; return state.mode; })()`);

  /* TTK_SEED：把种子固定住，改前/改后才会落到"同一批房间"上（逐房 id / 房型 / 怪物数一致），
     否则两次运行各掷各的随机布局，逐房对比与总时长中位数都没有可比性。 */
  if (process.env.TTK_SEED) {
    await ev(`(function(){ state.seedInfo = { active: true, value: '${process.env.TTK_SEED}', daily: false, custom: true, startedAt: 0 }; return state.seedInfo.value; })()`);
    console.log('SEED = ' + process.env.TTK_SEED);
  }

  const report = { tag: TAG, generatedAt: new Date().toISOString(), floors: [] };

  for (const floor of FLOORS) {
    /* 有些层会被 spawnSurvivalRoom 吃掉一间战斗房，只剩 1 间；
       这里最多重掷 6 次，挑"战斗/精英房最多"的那一版，保证每层至少采 2 间。 */
    /* TTK_REQUIRE=elite 时只采精英房（用于单独验证精英血量系数），否则采战斗房。 */
    const REQUIRE = process.env.TTK_REQUIRE || '';
    const want = REQUIRE === 'elite' ? 1 : ROOMS_PER_FLOOR;
    let graph = null;
    let battles = [];
    let bestCount = -1;
    let attempts = 0;
    for (let i = 0; i < (REQUIRE ? 20 : 6); i += 1) {
      /* TTK_FREEZE_RNG：改前/改后要落到"同一批房间"，光固定 seed 不够——本作的
         层布局与房型走 Math.random（rand() 只在种子局下才改道）。这里在 setFloor 前后
         临时把 Math.random 换成按 (楼层, 重掷次数) 定死的 LCG，生成完立刻还原，
         保证两次运行的房型 / 房间 id / 怪物数 / 怪物顺序逐条一致。 */
      if (process.env.TTK_FREEZE_RNG) {
        await ev(`(function(){
          window.__mrBackup = Math.random;
          var s = ${floor * 7919 + i * 104729 + 13};
          Math.random = function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
          return true;
        })()`);
      }
      await ev(`(function(){ window.__roamDebug.setFloor(${floor}); return state.floor; })()`);
      if (process.env.TTK_FREEZE_RNG) {
        await ev(`(function(){ Math.random = window.__mrBackup; return true; })()`);
      }
      await sleep(700);
      const g = await ev(`window.__roamDebug.floorGraph()`);
      const list = g.rooms
        .filter((r) => (REQUIRE === 'elite' ? r.type === 'elite' : (r.type === 'battle' || r.type === 'elite')))
        .sort((a, b) => (a.type === b.type ? a.id - b.id : (a.type === 'battle' ? -1 : 1)));
      const pure = list.filter((r) => r.type === (REQUIRE === 'elite' ? 'elite' : 'battle')).length;
      if (pure > bestCount) { bestCount = pure; graph = g; battles = list.slice(0, want); }
      attempts = i + 1;
      if (pure >= want) break;
    }
    const floorEntry = { floor, roomsCount: graph.rooms.length, layered: graph.layered, attempts, rooms: [] };

    for (const room of battles) {
      // 站到房心：先试正中心，被墙/障碍挡就退一步再试
      const placed = await ev(`(function(){
        var r = state.rooms[${room.id}];
        var dbg = window.__roamDebug;
        var tries = [[r.cx, r.cy], [r.cx, r.y + 90], [r.cx, r.y + r.h - 90], [r.x + 90, r.cy]];
        for (var i = 0; i < tries.length; i += 1) {
          if (dbg.teleport(tries[i][0], tries[i][1])) { state.currentRoomId = r.id; return { ok: true, at: tries[i], spawnCount: r.enemyCount, routeExtra: r.routeExtra || 0 }; }
        }
        return { ok: false };
      })()`);

      const before = await ev(`(state.ttkLog || []).length`);
      /* 施法由 Node 侧轮询驱动（不依赖页面内 rAF 长循环）：
         上一版把整套 45 秒循环塞进页面里，只要循环中途抛一次错，Promise 就永远不 resolve，
         探针会挂死。改成"每 120ms 让页面瞄准最近活怪并按 0.55s 冷却开火"，
         每次 evaluate 都是短调用，超时也能安全收尾。 */
      const driveStartedAt = Date.now();
      let driveLast = null;
      const samples = [];
      let tickNo = 0;
      while (Date.now() - driveStartedAt < DRIVE_SECONDS * 1000) {
        tickNo += 1;
        driveLast = await ev(`(function(){
          var ROOM = ${room.id};
          /* 清房会弹三选一 / 被动二选一，弹窗期间 state.mode 不是 'playing'，
             主循环随之暂停（state.elapsed 不再前进），整套采样会僵在原地。
             这里每 tick 自动点掉第一张奖励卡，保证时间继续走。 */
          var dismissed = null;
          if (state.mode !== 'playing') {
            var layer = document.querySelector('.modal-layer:not(.hidden)');
            if (layer) {
              var pick = layer.querySelector('[data-reward-key]');
              if (pick) { pick.click(); dismissed = 'reward'; }
              else {
                var skip = layer.querySelector('[data-action="skipPassive"]');
                if (skip) { skip.click(); dismissed = 'skipPassive'; }
              }
            }
          }
          var p = state.player;
          /* 换层时 applyMetaStats / generateFloor 会把 hpMax 重置回正常值，
             之前只在开局设过一次 99999，到 F20 早已被重置，玩家被打死（mode 变 result）
             采样就冻结了。这里每 tick 补满，保证"站桩挨打也不死"，不影响怪物数值。 */
          if (p.hpMax < 99999) { p.hpMax = 99999; }
          p.hp = p.hpMax;
          var roomRef = state.rooms[ROOM];
          /* 换层入场会把玩家拉回出生点，站桩位置每 tick 校正一次 */
          if (roomRef && Math.hypot(p.x - roomRef.cx, p.y - roomRef.cy) > 700) {
            window.__roamDebug.teleport(roomRef.cx, roomRef.cy);
            state.currentRoomId = ROOM;
          }
          var alive = (state.enemies || []).filter(function(e){ return e.hp > 0 && !e.isBoss && e.roomId === ROOM; });
          var best = null, bestD = Infinity;
          alive.forEach(function(e){
            var d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d < bestD) { bestD = d; best = e; }
          });
          if (best) {
            state.aim = state.aim || { angle: 0, moved: false };
            state.aim.angle = Math.atan2(best.y - p.y, best.x - p.x);
            state.aim.moved = true;
          }
          var cast = false;
          var now = state.elapsed || 0;
          if (best && state.mode === 'playing' && now - (window.__d3LastCast || -100) >= 0.55) {
            window.__d3LastCast = now;
            if (typeof castFireball === 'function') { castFireball(MAGIC_BY_ID.fireball, null); cast = true; }
          }
          return {
            roomAlive: alive.length, cast: cast, elapsed: Math.round(now * 10) / 10,
            /* v2.5.16：两波房会有一瞬"场上 0 只、第二波还没落位"，这不能算清房 */
            roomPending: (roomRef && roomRef.wavePending) ? roomRef.wavePending.length : 0,
            bestD: best ? Math.round(bestD) : null,
            px: Math.round(p.x), py: Math.round(p.y),
            proj: (state.projectiles || []).length,
            mode: state.mode,
            dismissed: dismissed
          };
        })()`);
        if (tickNo <= 6 || (tickNo % 40 === 0)) samples.push({ t: tickNo, ...driveLast });
        // 本房已清空（且没有排队中的第二波）就提前结束，别白等满 30 秒
        if (driveLast && driveLast.roomAlive === 0 && !driveLast.roomPending) break;
        await sleep(120);
      }
      const snap = await ev(`window.__roamDebug.ttk(${floor})`);
      const rows = snap.log.filter((row) => row.roomId === room.id);

      const aliveNow = await ev(`(state.enemies || []).filter(function(e){ return e.hp > 0; }).length`);
      const roomInfo = snap.rooms.find((r) => r.id === room.id) || {};

      // "首次接敌 → 最后死亡"：这才是"这间房打了多久"
      /* 只有真的清房（room.cleared）才把这段时长当"清场时长"；
         60 秒采样上限内没打完时，最后一个死亡时间只是"采样窗口内的最后一次击杀"，
         直接标成 null + timedOut，避免把没打完的房报成 44 秒清场。 */
      const clearedNow = !!roomInfo.cleared;
      const hits = rows.filter((r) => r.firstHit !== null).map((r) => r.firstHit);
      const deaths = rows.map((r) => r.died);
      const roomClear = (clearedNow && hits.length && deaths.length)
        ? Math.round((Math.max.apply(null, deaths) - Math.min.apply(null, hits)) * 100) / 100
        : null;

      floorEntry.rooms.push({
        roomId: room.id,
        roomType: room.type,
        depth: room.depth,
        placed,
        killedHere: rows.length,
        newLogRows: (snap.log.length) - before,
        aliveAtEnd: aliveNow,
        cleared: clearedNow,
        timedOut: !clearedNow,
        alivePeak: roomInfo.alivePeak || 0,
        roomClear,
        ttk: summarize(rows.map((r) => r.ttk)),
        ttkCombat: summarize(rows.map((r) => r.ttkCombat)),
        engage: summarize(rows.map((r) => r.engage)),
        hpMax: rows.length ? Math.round(rows.reduce((a, r) => a + r.hpMax, 0) / rows.length) : null,
        types: Array.from(new Set(rows.map((r) => r.typeId))),
        samples,
        raw: rows.map((r) => ({
          typeId: r.typeId,
          hpMax: r.hpMax,
          ttk: Math.round(r.ttk * 100) / 100,
          ttkCombat: r.ttkCombat === null ? null : Math.round(r.ttkCombat * 100) / 100,
          engage: r.engage === null ? null : Math.round(r.engage * 100) / 100
        }))
      });
      console.log('FLOOR', floor, 'ROOM', room.id, 'spawn', placed.spawnCount, 'killed', rows.length,
        'peak', roomInfo.alivePeak || 0, 'combatMed', floorEntry.rooms[floorEntry.rooms.length - 1].ttkCombat.median);
    }
    report.floors.push(floorEntry);
  }

  report.errors = await ev(`(window.__errors || []).slice(0, 10)`);
  const outFile = path.join(OUT_DIR, 'd3-ttk-' + TAG + '.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log('\n===== D3 TTK 采样 =====');
  report.floors.forEach((f) => {
    f.rooms.forEach((r) => {
      console.log(`F${f.floor} R${r.roomId} killed=${r.killedHere} peak=${r.alivePeak} clear=${r.roomClear}s `
        + `ttk[${r.ttk.min}/${r.ttk.median}/${r.ttk.max}] combat[${r.ttkCombat.min}/${r.ttkCombat.median}/${r.ttkCombat.max}] `
        + `hp~${r.hpMax} types=${r.types.join(',')}`);
    });
  });
  console.log('OUT', outFile);
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
