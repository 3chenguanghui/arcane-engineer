// 难度奇偶性验证：同一批 750 个「不同场景」/页，粘前 / 粘后逐局对比死亡与死因
// 用法：node tools/death_parity.js
// 说明：
// 1. 不构造伤害，全部走真实 spawnEnemy + updateEnemies / updateBullets（敌方弹幕）路径。
// 2. 场景表在 Node 里按局生成（HP、敌人数量与站位逐局不同），两页注入同一张表；
//    逐局输入必须完全一致，否则 50 局只是同一个场景重复 50 次，n=50 没有意义。
// 3. 两页在生成楼层前统一接管 Math.random 为固定种子 LCG，保证房间几何一致；
//    否则两页各自 generateFloor，墙体位置不同会制造与补丁无关的差异。
// 4. 每格（楼层 × 组成）50 局；逐局比对，只要出现 1 例差异就报 FAIL 并列出位置。
const { openPreview } = require('./preview_cdp');

const MAIN = 'D:\\其他\\TRAE宝\\奥术工程师\\index_arcane_v2.html';
const PATCHED = 'D:\\其他\\TRAE宝\\奥术工程师\\.reviewfix\\index_patched.html';
const PER_CELL = 50;

/**
 * 生成 750 个场景（5 层 × 近战/远程/空场 × 50 局）
 * HP 与敌人数量/站位逐局变化，让「死亡 / 存活」这一对照本身有分布，
 * 而不是 50 次重复同一个必死场景。
 * @returns {Array<{floor:number, comp:string, hp:number, enemies:Array, maxTicks:number}>}
 */
function buildScenarios() {
  const out = [];
  const comps = ['近战', '远程', '空场'];
  for (let f = 1; f <= 5; f += 1) {
    comps.forEach((comp) => {
      for (let g = 0; g < PER_CELL; g += 1) {
        // HP 20..239，按局错开取值；低血必死、高血可能存活，保证每格都有存活样本
        const hp = 20 + ((g * 37) % 220);
        const seed = f * 91 + g;
        const enemies = [];
        if (comp === '近战') {
          const n = 2 + (g % 2);            // 2 或 3 只游荡体
          for (let k = 0; k < n; k += 1) {
            const ang = seed * 2.39996 + k * (Math.PI * 2 / n);
            const rad = 16 + ((g + k * 7) % 14);
            enemies.push(['wanderer', +(Math.cos(ang) * rad).toFixed(2), +(Math.sin(ang) * rad).toFixed(2)]);
          }
        } else if (comp === '远程') {
          const n = 2 + (g % 3);            // 2 / 3 / 4 只射手傀儡
          for (let k = 0; k < n; k += 1) {
            const ang = seed * 1.7 + k * (Math.PI * 2 / n);
            const rad = 90 + ((g * 9 + k * 15) % 60);
            enemies.push(['shooter', +(Math.cos(ang) * rad).toFixed(2), +(Math.sin(ang) * rad).toFixed(2)]);
          }
        }
        out.push({ floor: f, comp: comp, hp: hp, enemies: enemies, maxTicks: enemies.length ? 600 : 60 });
      }
    });
  }
  return out;
}

const SCENARIOS = buildScenarios();

/** 构造页面内批处理表达式：固定随机种子 → 逐层生成 → 逐局跑真实战斗子系统 */
const BATCH = `(async () => {
  const d = window.__roamDebug;
  const SC = ${JSON.stringify(SCENARIOS)};

  // 固定种子接管 Math.random：两页楼层几何必须一致，否则墙体差异会伪装成回归
  const realRandom = Math.random;
  let __seed = 987654321;
  Math.random = () => {
    __seed = (__seed * 1103515245 + 12345) & 0x7fffffff;
    return __seed / 0x7fffffff;
  };

  const runs = [];
  let curFloor = 0;
  let room = null;
  try {
    for (const s of SC) {
      if (s.floor !== curFloor) {
        curFloor = s.floor;
        // 同步生成，不留 await：一旦让出主线程，两页的 RAF 循环会各自消费不同次数的随机数，
        // 后续楼层就会长出不同几何——那是测试脚手架制造的差异，不是补丁差异。
        d.onboard.showFloor(curFloor);
        room = state.rooms.find((r) => r.type === 'battle')
          || state.rooms.find((r) => r.id !== state.spawnRoomId);
      }
      state.mode = 'playing';
      state.status = 'playing';
      state.enemies.length = 0;
      if (state.enemyBullets) state.enemyBullets.length = 0;
      const p = state.player;
      p.x = room.cx;
      p.y = room.cy;
      state.currentRoomId = room.id;
      room.locked = true;
      if (typeof setRoomDoors === 'function') setRoomDoors(room, true);
      p.hp = s.hp;
      p.maxHp = Math.max(p.maxHp || 0, s.hp);
      p.invuln = 0;
      p.shield = 0;
      p.deepShield = 0;
      p.contactLock = 0;
      s.enemies.forEach(([id, dx, dy]) => d.enemies.spawn(id, p.x + dx, p.y + dy, {}));

      let dead = false;
      for (let i = 0; i < s.maxTicks && !dead; i += 1) {
        const dt = 1 / 60;
        // 真实主循环里 contactLock 由 updatePlayer 递减；这里只跑战斗子系统，按同一时钟递减
        if (p.contactLock > 0) p.contactLock = Math.max(0, p.contactLock - dt);
        updateEnemies(dt);
        updateBullets(dt);
        dead = state.mode === 'result' || state.status === 'dead' || p.hp <= 0;
      }
      let cause = '';
      if (dead) {
        const hit = state.lastHit || {};
        cause = (hit.kind || 'unknown') + ':' + (hit.name || '未知');
      }
      runs.push({ floor: s.floor, comp: s.comp, dead: dead, cause: cause, hp: s.hp });
    }
  } finally {
    Math.random = realRandom;
  }
  return runs;
})()`;

/** 跑一页，返回 750 条逐局结果 */
async function run(page) {
  const r = await openPreview(page, BATCH, { waitMs: 1500, timeoutMs: 420000 });
  if (r.errors && r.errors.length) throw new Error(page + ' 运行错误：' + r.errors.join(' | '));
  return r.value;
}

/**
 * 汇总单元格：死亡数、存活数、死因分布
 * @param {Array} runs 逐局结果
 * @returns {Map<string, Object>} key = 楼层|组成
 */
function cells(runs) {
  const map = new Map();
  runs.forEach((r) => {
    const key = r.floor + '|' + r.comp;
    if (!map.has(key)) map.set(key, { floor: r.floor, comp: r.comp, dead: 0, alive: 0, causes: {} });
    const c = map.get(key);
    if (r.dead) {
      c.dead += 1;
      c.causes[r.cause] = (c.causes[r.cause] || 0) + 1;
    } else {
      c.alive += 1;
    }
  });
  return map;
}

async function main() {
  const before = await run(MAIN);
  const after = await run(PATCHED);
  const cb = cells(before);
  const ca = cells(after);

  let bad = 0;
  const diffs = [];
  const per = new Map();
  // 逐局比对（顺序与场景表一致，两页注入同一张表，同下标即同一场景）
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    const b = before[i];
    const a = after[i];
    const same = b && a && b.dead === a.dead && b.cause === a.cause;
    if (b && a) {
      const key = b.floor + '|' + b.comp;
      per.set(key, (per.get(key) || 0) + (same ? 0 : 1));
    }
    if (!same) {
      bad += 1;
      if (diffs.length < 8) {
        diffs.push(`#${i} F${b ? b.floor : '?'} ${b ? b.comp : '?'} hp=${b ? b.hp : '?'} 粘前=${b ? (b.dead ? '死(' + b.cause + ')' : '活') : '缺'} 粘后=${a ? (a.dead ? '死(' + a.cause + ')' : '活') : '缺'}`);
      }
    }
  }

  console.log('楼层  组成  粘前（死亡/50，死因）                          粘后（死亡/50，死因）                          逐局差异');
  cb.forEach((b, key) => {
    const a = ca.get(key) || { dead: -1, causes: {} };
    const cellDiff = per.get(key) || 0;
    console.log(`F${b.floor}    ${b.comp}  ${(b.dead + '/50 ' + JSON.stringify(b.causes)).padEnd(44)}  ${(a.dead + '/50 ' + JSON.stringify(a.causes)).padEnd(44)}  ${cellDiff}`);
  });

  console.log(`\n总死亡：粘前 ${before.filter((r) => r.dead).length} / 粘后 ${after.filter((r) => r.dead).length}（每页 ${before.length} 局）`);
  console.log(`逐局一致：${Math.max(before.length, after.length) - bad}/${Math.max(before.length, after.length)}`);
  console.log('逐格差异计数：' + Array.from(per.entries()).map(([k, v]) => `${k.replace('|', ' ')}:${v}`).join('  '));
  if (diffs.length) {
    console.log('前几例差异：');
    diffs.forEach((line) => console.log('  ' + line));
  }
  console.log(`VERDICT: ${bad === 0 && after.length === before.length ? 'PASS' : 'FAIL'}`);
  process.exitCode = bad === 0 && after.length === before.length ? 0 : 1;
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
