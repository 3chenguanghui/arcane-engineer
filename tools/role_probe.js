/**
 * 三角色平衡探针：复用项目自带的引擎模拟器 tools/sim_panel/sim.js。
 * 只做读数，不改模拟器一行；角色差异通过 charSpec（模拟器已支持的探针入口）注入。
 *
 * 用法：node tools/role_probe.js [--runs 400]
 * 输出：每个角色的 F1–3 存活率、F1–3 平均耗时（仅通关者）、平均死亡楼层，全部带样本数。
 */
const path = require('path');
const SIM = require(path.join(__dirname, 'sim_panel', 'sim.js'));
const C = require(path.join(__dirname, 'sim_panel', 'config.js'));

/** 读取命令行 --runs（默认 400 局/角色） */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 400;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 400;
}

/**
 * 三角色配置（与 roles-select.html 的 ROLES 表同源）。
 * 只使用模拟器 charSpec 支持的旋钮：hpFlat / magics / regenBonus / growthBias。
 * 未建模：起始奥能上限、移速、冷却（模拟器不结算这三项，报告中单独注明）。
 */
const ROLES = [
  {
    id: 'warden', name: '守拙',
    charSpec: { hpFlat: 32, magics: ['flameCone', 'fireball'], regenBonus: 2, growthBias: { value: 0.45, survival: 0.55 } }
  },
  {
    id: 'ember', name: '疾火',
    charSpec: { hpFlat: -4, magics: ['fireball', 'blade'], regenBonus: 4, growthBias: { value: 0.85, survival: 0.15 } }
  },
  {
    id: 'gazer', name: '观星',
    charSpec: { hpFlat: -4, magics: ['fireball', 'frost'], regenBonus: 2, growthBias: { value: 0.55, survival: 0.45 } }
  },
  {
    id: 'none', name: '无角色（基线）',
    charSpec: { hpFlat: 0, magics: ['fireball', 'frost'], regenBonus: 0, growthBias: null }
  }
];

/**
 * 跑一个角色的 N 局并聚合。
 * @param {Object} role 角色配置
 * @param {number} runs 局数
 * @returns {Object} 聚合结果
 */
function probeRole(role, runs) {
  let survived3 = 0;          // 通过第 3 层的样本数
  let time3Sum = 0;           // 通关者 F1→F3 累计秒数
  let diedCount = 0;          // 有死亡楼层的样本数
  let deathSum = 0;           // 死亡楼层累加
  let clearedAll = 0;         // 跑满 20 层未死的样本数

  for (let i = 0; i < runs; i += 1) {
    const seed = C.SIM_PARAMS.baseSeed + i;
    const r = SIM.runOne(seed, C.PROFILES.bot, 'normal', { charSpec: role.charSpec });
    if (r.clearedFloors >= 3) {
      survived3 += 1;
      const t = r.floorTrace.slice(0, 3);
      time3Sum += t.reduce((s, f) => s + (f.clearSeconds || 0), 0);
    }
    if (r.died) {
      diedCount += 1;
      deathSum += r.deathFloor;
    } else if (r.clearedFloors >= C.SIM_PARAMS.maxFloor) {
      clearedAll += 1;
    }
  }

  return {
    id: role.id,
    name: role.name,
    samples: runs,
    survived3,
    f3Rate: survived3 / runs,
    avgTime3: survived3 ? time3Sum / survived3 : 0,
    diedCount,
    avgDeathFloor: diedCount ? deathSum / diedCount : 0,
    fullClear: clearedAll
  };
}

/** 控制台表格输出 */
function printTable(rows) {
  const pad = (s, n) => String(s).padEnd(n, ' ');
  console.log(pad('角色', 16) + pad('样本', 6) + pad('F1-3存活率', 12) + pad('F1-3耗时(s)', 14) + pad('平均死亡层', 12) + '死亡样本');
  rows.forEach((r) => {
    console.log(
      pad(r.name + '(' + r.id + ')', 16)
      + pad(r.samples, 6)
      + pad((r.f3Rate * 100).toFixed(1) + '%', 12)
      + pad('n=' + r.survived3 + ' ' + r.avgTime3.toFixed(1), 14)
      + pad((r.avgDeathFloor ? r.avgDeathFloor.toFixed(2) : '—'), 12)
      + r.diedCount
    );
  });
}

const runs = readRuns();

/* 调参矩阵：node tools/role_probe.js --matrix --runs 200
   用来快速找三角色落点，正式数据仍由上面的默认 ROLES 输出。 */
if (process.argv.includes('--matrix')) {
  const grid = [
    { id: 'w-r2', name: '守拙 132/回18', charSpec: { hpFlat: 32, magics: ['flameCone', 'fireball'], regenBonus: 2, growthBias: { value: 0.45, survival: 0.55 } } },
    { id: 'w-r4', name: '守拙 132/回20', charSpec: { hpFlat: 32, magics: ['flameCone', 'fireball'], regenBonus: 4, growthBias: { value: 0.45, survival: 0.55 } } },
    { id: 'w-r6', name: '守拙 132/回22', charSpec: { hpFlat: 32, magics: ['flameCone', 'fireball'], regenBonus: 6, growthBias: { value: 0.45, survival: 0.55 } } },
    { id: 'e-blade', name: '疾火 96/回20 光轮', charSpec: { hpFlat: -4, magics: ['fireball', 'blade'], regenBonus: 4, growthBias: { value: 0.85, survival: 0.15 } } },
    { id: 'g-96r2', name: '观星 96/回18 冰环', charSpec: { hpFlat: -4, magics: ['fireball', 'frost'], regenBonus: 2, growthBias: { value: 0.55, survival: 0.45 } } },
    { id: 'g-100r2', name: '观星 100/回18 冰环', charSpec: { hpFlat: 0, magics: ['fireball', 'frost'], regenBonus: 2, growthBias: { value: 0.55, survival: 0.45 } } },
    { id: 'g-96r4', name: '观星 96/回20 冰环', charSpec: { hpFlat: -4, magics: ['fireball', 'frost'], regenBonus: 4, growthBias: { value: 0.55, survival: 0.45 } } }
  ];
  printTable(grid.map((role) => probeRole(role, runs)));
  process.exit(0);
}

const rows = ROLES.map((role) => probeRole(role, runs));
printTable(rows);
console.log('\nJSON=' + JSON.stringify(rows));
