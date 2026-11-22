/**
 * F1–F5 密度 / 首波 / 簇 / 总血探针（只读，不改主文件）
 * ------------------------------------------------------------
 * 为什么单独写：tools/arcane_ladder.js 跑全 20 层，改前就会在 F7 触发既有的
 * 「[D2] duplicate non-battle room type」生成报错，没法用来复标前五层。
 * 本探针只掷 F1–F5，直接用主文件真实的 generateFloor / spawnEnemiesForFloor。
 *
 * 口径：
 *   · 每层掷房 ROLLS 次（默认 40），每次读战斗房 / 精英房：
 *       总怪 = room.enemyCount（含排队）
 *       首波 = 生成后立刻在场、且 roomId 匹配的怪数
 *       簇数 / 簇半径 = 对首波坐标做 80px 单链接聚类后统计
 *       簇面积占比 = Σπ·r² / (room.w × room.h)
 *       首波总血 = Σ(hpMax + shieldHpMax)
 *   · 等级/经验不在这里算（用 tools/rhythm_probe.js）。
 *
 * 用法：node tools\f1f5_scale_probe.js [掷房次数] [tag]
 * 产物：tools/rhythm_out/f1f5_<tag>.json
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.ARCANE_PROFILE_ROOT = path.join(__dirname, '..', '.testprofile', 'f1f5-' + Date.now());
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9800 + Math.floor(Math.random() * 100);
const ROOT = path.join(__dirname, '..');
const FILE = process.env.ARCANE_FILE || path.join(ROOT, 'index_arcane_v2.html');
const ROLLS = Math.max(5, parseInt(process.argv[2], 10) || 40);
const TAG = process.argv[3] || 'after';
const OUT_DIR = path.join(ROOT, 'tools', 'rhythm_out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并连上 CDP
 * @returns {Promise<{send:Function, ev:Function, close:Function}>}
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
  return { send, ev, close: () => { try { killEdge(edge); } catch (e) { /* 忽略 */ } } };
}

/**
 * 生成"掷房 + 采样"的页面内表达式
 * @param {number} floor 层号
 * @returns {string} 可直接 Runtime.evaluate 的表达式
 */
function sampleExpr(floor) {
  return `(() => {
    /* 单链接聚类：两点距离 ≤ 阈值就并簇（战斗房单簇 ~62px 间距，精英房三簇 ~350px 间隔） */
    const clusterOf = (pts, thr) => {
      const parent = pts.map((_, i) => i);
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let i = 0; i < pts.length; i += 1) {
        for (let j = i + 1; j < pts.length; j += 1) {
          const dx = pts[i][0] - pts[j][0];
          const dy = pts[i][1] - pts[j][1];
          if (dx * dx + dy * dy <= thr * thr) parent[find(i)] = find(j);
        }
      }
      const groups = new Map();
      pts.forEach((p, i) => {
        const k = find(i);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      });
      return Array.from(groups.values());
    };
    /* k-means(k=2) 实测簇：不依赖设计簇信息，纯按首波坐标分组，
       用来回答"玩家真正看到的两个团到底多大、相距多远"。 */
    const kmeans2 = (pts) => {
      let c0 = pts[0];
      let c1 = pts[0];
      let best = -1;
      pts.forEach((p) => {
        const d = Math.hypot(p[0] - c0[0], p[1] - c0[1]);
        if (d > best) { best = d; c1 = p; }
      });
      let ax = c0[0]; let ay = c0[1]; let bx = c1[0]; let by = c1[1];
      for (let it = 0; it < 12; it += 1) {
        const g0 = []; const g1 = [];
        pts.forEach((p) => {
          const d0 = (p[0] - ax) * (p[0] - ax) + (p[1] - ay) * (p[1] - ay);
          const d1 = (p[0] - bx) * (p[0] - bx) + (p[1] - by) * (p[1] - by);
          if (d0 <= d1) g0.push(p); else g1.push(p);
        });
        if (!g0.length || !g1.length) return null;
        ax = g0.reduce((s, p) => s + p[0], 0) / g0.length;
        ay = g0.reduce((s, p) => s + p[1], 0) / g0.length;
        bx = g1.reduce((s, p) => s + p[0], 0) / g1.length;
        by = g1.reduce((s, p) => s + p[1], 0) / g1.length;
      }
      const rad = (g, x, y) => g.reduce((m, p) => Math.max(m, Math.hypot(p[0] - x, p[1] - y)), 0);
      const g0 = []; const g1 = [];
      pts.forEach((p) => {
        const d0 = (p[0] - ax) * (p[0] - ax) + (p[1] - ay) * (p[1] - ay);
        const d1 = (p[0] - bx) * (p[0] - bx) + (p[1] - by) * (p[1] - by);
        if (d0 <= d1) g0.push(p); else g1.push(p);
      });
      const r0 = rad(g0, ax, ay);
      const r1 = rad(g1, bx, by);
      return {
        clusters: 2,
        radius: Math.max(r0, r1),
        radiusMin: Math.min(r0, r1),
        dist: Math.hypot(ax - bx, ay - by),
        area: Math.PI * r0 * r0 + Math.PI * r1 * r1
      };
    };
    const acc = { battle: [], elite: [], species: [], dbg: null };
    const allSpecies = new Set();
    for (let i = 0; i < ${ROLLS}; i += 1) {
      __roamDebug.enemies.floor(${floor});
      const rollSpecies = new Set();
      state.rooms.forEach((r) => {
        if (r.type !== 'battle' && r.type !== 'elite') return;
        if (!(r.enemyCount > 0)) return;
        const foes = state.enemies.filter((e) => e.roomId === r.id);
        if (!foes.length) return;
        foes.forEach((e) => { const id = e.typeId || '?'; rollSpecies.add(id); allSpecies.add(id); });
        /* 排队中的第二波也算"本局会出场"——否则保底独占怪被排进队列时会被漏计 */
        const pending = (r.wavePending || []).map((q) => q.typeId);
        pending.forEach((id) => { if (id) { rollSpecies.add(id); allSpecies.add(id); } });
        if (!acc.dbg && r.type === 'battle') {
          acc.dbg = {
            room: { x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy, type: r.type },
            pts: foes.slice(0, 8).map((e) => [Math.round(e.x), Math.round(e.y)]),
            spawnClusters: r.spawnClusters || null
          };
        }
        const pts = foes.map((e) => [e.x, e.y]);
        const groups = clusterOf(pts, 80);
        let area = 0;
        let maxR = 0;
        groups.forEach((g) => {
          const cx = g.reduce((s, p) => s + p[0], 0) / g.length;
          const cy = g.reduce((s, p) => s + p[1], 0) / g.length;
          let rad = 0;
          g.forEach((p) => { rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cy)); });
          maxR = Math.max(maxR, rad);
          area += Math.PI * rad * rad;
        });
        /* 设计簇：主文件在 B3 分支里写进 room.spawnClusters（仅战斗房 count>=8） */
        let designed = null;
        if (r.spawnClusters && r.spawnClusters.length) {
          const cs = r.spawnClusters;
          let dArea = 0;
          cs.forEach((c) => { dArea += Math.PI * c.r * c.r; });
          designed = {
            clusters: cs.length,
            radius: Math.round(cs[0].r),
            dist: cs.length > 1
              ? Math.round(Math.hypot(cs[0].x - cs[1].x, cs[0].y - cs[1].y))
              : 0,
            areaRatio: +(dArea / Math.max(1, r.w * r.h)).toFixed(4)
          };
        }
        /* 实测簇：k-means k=2，完全从首波坐标算出来（不读设计信息） */
        let measured = null;
        if (r.type === 'battle' && pts.length >= 8) {
          const km = kmeans2(pts);
          if (km) {
            measured = {
              clusters: km.clusters,
              radius: Math.round(km.radius),
              dist: Math.round(km.dist),
              areaRatio: +(km.area / Math.max(1, r.w * r.h)).toFixed(4)
            };
          }
        }
        const hp = foes.reduce((s, e) => s + Math.max(0, e.hpMax || 0) + Math.max(0, e.shieldHpMax || 0), 0);
        /* B2 验账：本房独占怪只数（炉心祭司 / 虚空主教） */
        const exclusiveCount = foes.filter((e) => e.typeId === 'forgepriest' || e.typeId === 'voidbishop').length
          + pending.filter((id) => id === 'forgepriest' || id === 'voidbishop').length;
        /* B5 验账：本房精英体只数（F5 精英房目标 2） */
        const eliteCount = foes.filter((e) => !!e.elite).length
          + (r.wavePending || []).filter((q) => q.opts && q.opts.elite).length;
        acc[r.type].push({
          n: r.enemyCount,
          first: foes.length,
          hp: Math.round(hp),
          clusters: groups.length,
          maxR: Math.round(maxR),
          areaRatio: +(area / Math.max(1, r.w * r.h)).toFixed(4),
          designed,
          measured,
          exclusiveCount,
          eliteCount,
          w: r.w,
          h: r.h
        });
      });
      acc.species.push(rollSpecies.size);
    }
    acc.speciesUnion = allSpecies.size;
    acc.speciesList = Array.from(allSpecies).sort();
    return acc;
  })()`;
}

/**
 * 对一组样本求均值 / 中位 / 极值
 * @param {number[]} arr 数值数组
 * @returns {{avg:number, mid:number, min:number, max:number}}
 */
function stat(arr) {
  if (!arr.length) return { avg: 0, mid: 0, min: 0, max: 0 };
  const a = arr.slice().sort((x, y) => x - y);
  return {
    avg: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2),
    mid: a[Math.floor(a.length / 2)],
    min: a[0],
    max: a[a.length - 1]
  };
}

/**
 * 主流程：启动浏览器 → 逐层掷房 → 汇总并落盘
 */
async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { send, ev, close } = await connect();
  try {
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    for (let i = 0; i < 120; i += 1) {
      const ready = await ev('typeof startGame === "function"').catch(() => false);
      if (ready === true) break;
      await sleep(200);
    }
    await ev(`(() => { window.__charSkipPick = true; window.__charPickedThisBoot = true;
      try { closeCharSelect(); } catch (e) {}
      const layer = document.getElementById('charLayer'); if (layer) layer.style.display = 'none';
      startGame(); return true; })()`);
    await sleep(700);
    await ev(`FLOOR_MOD_CONFIG.enabled = false; state.floorMod = null; true`);
    await ev(`__roamDebug.enemies.setAdaptive(false)`);
    const scales = await ev(`(() => { const o = {}; for (let f = 1; f <= 5; f += 1) o[f] = ENEMY_BUDGET_CONFIG.rampByFloor[f]; return o; })()`);
    /* A8 是否真的生效：本层名册 + 可用编队模板（模板 roles 必须全部在名册里）
       B4 验账：本层首领是谁 + 首领血量（bossKindForFloor 的实测出口） */
    const rosterInfo = await ev(`(() => { const o = {};
      for (let f = 1; f <= 5; f += 1) {
        const k = bossKindForFloor(f);
        const st = bossStatsForFloor(f);
        o[f] = {
          roster: enemyRosterForFloor(f),
          formations: formationsForFloor(f).map((t) => t.id),
          boss: k ? { id: k.id, name: k.name } : null,
          bossHp: st ? st.hp : null
        };
      }
      return o; })()`);

    const floors = [];
    for (let f = 1; f <= 5; f += 1) {
      const raw = await ev(sampleExpr(f));
      const summarize = (list) => {
        if (!list.length) return null;
        const pick = (fn) => list.filter(fn).map(fn);
        const designed = pick((x) => x.designed);
        const measured = pick((x) => x.measured);
        const dR = designed.length ? +(designed.reduce((s, x) => s + x.radius, 0) / designed.length).toFixed(1) : null;
        const mR = measured.length ? +(measured.reduce((s, x) => s + x.radius, 0) / measured.length).toFixed(1) : null;
        return {
          rooms: list.length,
          nAvg: stat(list.map((x) => x.n)).avg,
          firstAvg: stat(list.map((x) => x.first)).avg,
          firstRange: [stat(list.map((x) => x.first)).min, stat(list.map((x) => x.first)).max],
          /* 旧口径：80px 单链接（保留做对照，不再作为"簇数/面积"的判据） */
          clustersAvg: stat(list.map((x) => x.clusters)).avg,
          radiusAvg: stat(list.map((x) => x.maxR)).avg,
          areaRatioAvg: +(list.reduce((s, x) => s + x.areaRatio, 0) / list.length).toFixed(4),
          /* 设计簇（由面积反推的半径，不是实测） */
          designedClustersAvg: designed.length
            ? +(designed.reduce((s, x) => s + x.clusters, 0) / designed.length).toFixed(2) : null,
          designedRadiusAvg: dR,
          designedDistAvg: designed.length
            ? Math.round(designed.reduce((s, x) => s + x.dist, 0) / designed.length) : null,
          designedAreaRatioAvg: designed.length
            ? +(designed.reduce((s, x) => s + x.areaRatio, 0) / designed.length).toFixed(4) : null,
          /* 实测簇（k-means k=2，纯坐标） */
          measuredClustersAvg: measured.length ? 2 : null,
          measuredRadiusAvg: mR,
          measuredDistAvg: measured.length
            ? Math.round(measured.reduce((s, x) => s + x.dist, 0) / measured.length) : null,
          measuredAreaRatioAvg: measured.length
            ? +(measured.reduce((s, x) => s + x.areaRatio, 0) / measured.length).toFixed(4) : null,
          /* 设计 vs 实测半径差（>30% 以实测为准） */
          radiusDiffPct: (dR != null && mR) ? +(((dR - mR) / mR) * 100).toFixed(1) : null,
          /* B2：独占怪出现率（房间级）与每房只数 */
          exclusiveRate: +(list.filter((x) => x.exclusiveCount > 0).length / list.length).toFixed(3),
          exclusiveAvg: +(list.reduce((s, x) => s + x.exclusiveCount, 0) / list.length).toFixed(2),
          exclusiveMax: Math.max.apply(null, list.map((x) => x.exclusiveCount)),
          /* B5：精英体只数 */
          eliteCountAvg: +(list.reduce((s, x) => s + x.eliteCount, 0) / list.length).toFixed(2),
          eliteCountMax: Math.max.apply(null, list.map((x) => x.eliteCount)),
          hpAvg: stat(list.map((x) => x.hp)).avg,
          wAvg: stat(list.map((x) => x.w)).avg,
          hAvg: stat(list.map((x) => x.h)).avg
        };
      };
      floors.push({
        floor: f,
        battle: summarize(raw.battle),
        elite: summarize(raw.elite),
        /* 本层"一局里真实出场过几种"：每掷一次记一个并集，取均值；再多局并集 */
        speciesAvg: raw.species.length
          ? +(raw.species.reduce((s, v) => s + v, 0) / raw.species.length).toFixed(2) : 0,
        speciesUnion: raw.speciesUnion,
        speciesList: raw.speciesList,
        dbg: raw.dbg || null,
        roster: rosterInfo[f] ? rosterInfo[f].roster : [],
        formations: rosterInfo[f] ? rosterInfo[f].formations : [],
        boss: rosterInfo[f] ? rosterInfo[f].boss : null,
        bossHp: rosterInfo[f] ? rosterInfo[f].bossHp : null
      });
    }
    const out = { tag: TAG, file: FILE, rolls: ROLLS, scales, floors };
    fs.writeFileSync(path.join(OUT_DIR, 'f1f5_' + TAG + '.json'), JSON.stringify(out, null, 2));
    floors.forEach((r) => {
      const b = r.battle || {};
      const e = r.elite || {};
      console.log(`F${r.floor} | 战斗房 ${b.rooms} 样本 | 总怪 ${b.nAvg} | 首波 ${b.firstAvg} (${(b.firstRange || []).join('–')}) | 首波总血 ${b.hpAvg}`);
      if (b.rooms) {
        console.log(`      簇（设计）${b.designedClustersAvg} 个 | 半径 ${b.designedRadiusAvg}px（面积反推） | 簇心距 ${b.designedDistAvg}px | 面积占比 ${(b.designedAreaRatioAvg * 100).toFixed(2)}%`);
        console.log(`      簇（实测k2）${b.measuredClustersAvg} 个 | 半径 ${b.measuredRadiusAvg}px | 簇心距 ${b.measuredDistAvg}px | 面积占比 ${(b.measuredAreaRatioAvg * 100).toFixed(2)}% | 设计/实测半径差 ${b.radiusDiffPct}%`);
        console.log(`      旧口径80px单链接：簇 ${b.clustersAvg} | 半径 ${b.radiusAvg}px | 面积占比 ${(b.areaRatioAvg * 100).toFixed(2)}%`);
        console.log(`      独占怪：房间出现率 ${(b.exclusiveRate * 100).toFixed(0)}% | 每房均 ${b.exclusiveAvg} 只 | 最多 ${b.exclusiveMax} 只`);
      }
      if (e.rooms) console.log(`      精英房 ${e.rooms} 样本 | 总怪 ${e.nAvg} | 首波 ${e.firstAvg} | 精英体均 ${e.eliteCountAvg} 只（最多 ${e.eliteCountMax}） | 簇 ${e.clustersAvg} | 面积占比 ${(e.areaRatioAvg * 100).toFixed(2)}% | 首波总血 ${e.hpAvg}`);
      console.log(`      物种：一局均 ${r.speciesAvg} 种 / 多局并集 ${r.speciesUnion} 种（${(r.speciesList || []).join(',')}）`);
      console.log(`      名册 ${(r.roster || []).length} 只 | 可用编队 ${(r.formations || []).join(',') || '无'} | 首领 ${r.boss ? (r.boss.name + '(' + r.boss.id + ')') : '无'} | 首领血 ${r.bossHp == null ? '—' : Math.round(r.bossHp)}`);
    });
  } finally {
    close();
  }
}

run().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
