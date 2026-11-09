/* ============================================================================
 * 《烬》三角色平衡探针（只读主文件；只改离线模拟器的“角色/天赋静态乘区”）
 * ----------------------------------------------------------------------------
 * 目的：给“开局三选一”的三个角色算三条判据 + 双倍膨胀 + 凹点变化。
 *
 * 用法：
 *   node probe_chars.js --runs 6000 --talent-runs 2000 --out probe_chars.json
 *
 * 口径说明：
 *   1) 角色只落在五个旋钮：起始生命 / 起始奥能 / 起始技能组 / 被动 / 成长偏向。
 *   2) 起始奥能当前模拟器**不建模**（供给是 16/s 回复，上限不进入战斗结算），
 *      因此本探针把所有角色的起始奥能都设为 100，差异标“未测”。
 *   3) 被动用已有的科技卡表示（amp / field / nanite / concentrator / phase），
 *      与主文件 TECH_CONFIG 同源；不新造被动。
 *   4) 成长偏向 = 升级三选一的评分权重（默认 0.7 伤害 / 0.3 生存）。
 *   5) 天赋是账号级静态加成，按主文件 TALENT_CONFIG + 封顶表折算成乘区，
 *      不走局内卡片，避免和 build 成长重复计算。
 * ============================================================================ */
'use strict';

const C = require('./config.js');
const S = require('./sim.js');

const IDS = ['novice', 'veteran', 'bot'];
const FLOORS = 20;
/* 操作水平口径：mix（默认，与历史基线一致，按 i%3 轮换）/ bot（只跑机器人，用于和对方线对齐） */
let PROFILE_MODE = 'mix';

/* ---------------------------------------------------------------------------
 * 角色定义（五旋钮）
 * ------------------------------------------------------------------------- */
const CHARACTERS = {
  base: {
    id: 'base', label: '基准（无角色）',
    hpPct: 0, magics: ['fireball', 'frost'], techs: [], growthBias: null
  },
  ember: {
    id: 'ember', label: '焰·爆裂',
    hpPct: 0.0,                                    // 起始生命 100（标定：95 时 10 层 34.2%，偏低）
    magics: ['fireball', 'blade'],                 // 单体高伤 + 回旋刃
    techs: ['amp'],                                // 被动：增幅 +8% 伤害
    growthBias: { value: 0.80, survival: 0.20 }    // 成长偏输出
  },
  frost: {
    id: 'frost', label: '霜·守御',
    hpPct: 0.0,                                    // 起始生命 100（不靠血量，靠轻甲）
    magics: ['fireball', 'frost'],                 // 主槽火球 + 副槽冰环（与基准同组，差异走被动/成长）
    techs: [],                                     // 被动走 takenMul：冰霜护甲 -3% 承伤
    takenMul: 0.97,                                // 现有 field 是 -15%，实测会把 10 层打到 46.8%，不能用
    growthBias: { value: 0.65, survival: 0.35 }    // 成长偏生存
  },
  volt: {
    id: 'volt', label: '雷·引能',
    hpPct: -0.08,                                  // 起始生命 92（脆，换供能）
    magics: ['fireball', 'bolt'],                  // 主槽火球（高性价比）+ 副槽雷击
    techs: ['concentrator'],                       // 被动：聚能模块 +2 奥能/秒
    growthBias: { value: 0.55, survival: 0.45 }    // 均衡
  },
  /* —— 以下三个是“写权线已落盘”的 v1.7.0 初稿（只用于对照，不是本报告的建议值）——
     逐层成长（hpPerFloor / aetherPerFloor）本模拟器不建模，故只注入起始值；
     aetherFlat / aetherExtra 同样不建模（供给只看 baseRegen）。 */
  warden: {
    id: 'warden', label: '守拙(落地稿)',
    hpPct: 0.08, hpFlat: 20,                       // 100×(1+8%)+20 = 128
    magics: ['fireball', 'frost'], techs: []
  },
  ember2: {
    id: 'ember2', label: '疾火(落地稿)',
    hpPct: 0, hpFlat: -10,                         // 90
    magics: ['fireball', 'frost'], techs: []
  },
  gazer: {
    id: 'gazer', label: '观星(落地稿)',
    hpPct: 0, hpFlat: 0,                           // 100
    magics: ['frost', 'fireball'],                 // active = 冰环 → 主槽冰环
    techs: [], regenBonus: 2                       // regenFlat +2 奥能/秒
  },
  /* —— 落地稿的“修正值”：只改与判据直接相关的那一格，其他身份描述尽量保留 —— */
  warden2: {
    id: 'warden2', label: '守拙(修正108)',
    hpPct: 0.08, hpFlat: 0,                        // 只留 +8% 血厚，撤掉 +20 定点 → 108
    magics: ['fireball', 'frost'], techs: []
  },
  ember3: {
    id: 'ember3', label: '疾火(修正)',
    hpPct: 0, hpFlat: 0,                           // 撤掉 -10 → 100
    magics: ['fireball', 'frost'], techs: []
  },
  gazer2: {
    id: 'gazer2', label: '观星(修正)',
    hpPct: 0, hpFlat: 0,                           // 100，保留 +2 回能
    magics: ['fireball', 'frost'],                 // 主槽回火球，冰环退回副槽
    techs: [], regenBonus: 2
  },
  warden3: {
    id: 'warden3', label: '守拙(修正104)',
    hpPct: 0.04, hpFlat: 0,                        // 104：给 10 层留 0 余量以上（108 实测 39.73% 太贴线）
    magics: ['fireball', 'frost'], techs: []
  },
  ember4: {
    id: 'ember4', label: '疾火(修正95+增幅)',
    hpPct: -0.05, hpFlat: 0,                       // 95：血薄由被动补偿
    magics: ['fireball', 'frost'], techs: ['amp']  // 被动回到“输出型”：增幅 +8%
  },
  /* —— 另一条线（ui-lab/角色设定.md + tools/role_probe.js）的角色定义，逐键照抄 —— */
  w132: {
    id: 'w132', label: '守拙132(焰锥主槽)',
    hpPct: 0, hpFlat: 32,                          // 132
    magics: ['flameCone', 'fireball'], regenBonus: 2,
    growthBias: { value: 0.45, survival: 0.55 }
  },
  w132f: {
    id: 'w132f', label: '守拙132(火球主槽)',
    hpPct: 0, hpFlat: 32,                          // 132，只把主槽换成火球
    magics: ['fireball', 'flameCone'], regenBonus: 2,
    growthBias: { value: 0.45, survival: 0.55 }
  },
  e96: {
    id: 'e96', label: '疾火96(对方)',
    hpPct: 0, hpFlat: -4,
    magics: ['fireball', 'blade'], regenBonus: 4,
    growthBias: { value: 0.85, survival: 0.15 }
  },
  g96: {
    id: 'g96', label: '观星96(对方)',
    hpPct: 0, hpFlat: -4,
    magics: ['fireball', 'frost'], regenBonus: 2,
    growthBias: { value: 0.55, survival: 0.45 }
  }
};

/* ---------------------------------------------------------------------------
 * 天赋档位（按主文件配置折算成静态乘区）
 * ---------------------------------------------------------------------------
 * T1 = 只买满 tier1：伤害 稳击 +12%，暴击 +12% 暴击率（期望折算 ×1.067）
 *      → 1.12 × 1.067 ≈ 1.195；减伤 坚壁 -16%；生命 体魄 +10%；冷却 -10%
 * T2 = tier1+tier2：伤害类原始值已超 +35% 封顶 → 1.35；减伤仍 16%；
 *      治疗 噬血 +30%；冷却 -10%
 * T3 = 全部 30 项满级：伤害 1.35（封顶）、减伤 0.70（-30% 封顶）、
 *      治疗 1.30、冷却 0.90、生命 +10%
 * 进阶对冲（挑战等级）不在“天赋”里，本表不含。
 * ------------------------------------------------------------------------- */
const TALENTS = {
  T0: { id: 'T0', label: '无天赋', hpPct: 0, damageMul: 1, takenMul: 1, cdrMul: 1, healMul: 1 },
  T1: { id: 'T1', label: 'tier1 满', hpPct: 0.10, damageMul: 1.195, takenMul: 0.84, cdrMul: 0.90, healMul: 1.00 },
  T2: { id: 'T2', label: 'tier1+2 满', hpPct: 0.10, damageMul: 1.35, takenMul: 0.84, cdrMul: 0.90, healMul: 1.30 },
  T3: { id: 'T3', label: '全 30 项满', hpPct: 0.10, damageMul: 1.35, takenMul: 0.70, cdrMul: 0.90, healMul: 1.30 },
  /* 临时标定：假设把封顶砍到“伤害 +12% / 减伤 -10% / 治疗 +10%”，看能不能把 10 层压回 40% */
  T3c: { id: 'T3c', label: '满级(砍封顶)', hpPct: 0.10, damageMul: 1.12, takenMul: 0.90, cdrMul: 0.90, healMul: 1.10 }
};

/**
 * 解析命令行参数（只支持本探针用到的几个）
 * @returns {Object} 参数
 */
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { runs: 6000, talentRuns: 2000, out: 'probe_chars.json', chars: 'all' };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--runs') o.runs = Number(a[i + 1]);
    if (a[i] === '--talent-runs') o.talentRuns = Number(a[i + 1]);
    if (a[i] === '--out') o.out = a[i + 1];
    if (a[i] === '--chars') o.chars = a[i + 1];
    if (a[i] === '--profile') PROFILE_MODE = a[i + 1];
  }
  return o;
}

/**
 * 把一局结果折算进聚合器（逐层进入/死亡/首领战时长 + 三条判据）
 * @param {Object} agg 聚合器
 * @param {Object} r 单局结果
 * @returns {void}
 */
function addRun(agg, r) {
  r.floorTrace.forEach((ft) => {
    const f = ft.floor;
    const s = agg.floors[f];
    s.enter += 1;
    if (ft.died) {
      s.deaths += 1;
      const cause = ft.deathRoom || 'other';
      s.causes[cause] = (s.causes[cause] || 0) + 1;
    } else {
      s.clear += 1;
    }
    if (ft.boss) {
      s.bossFights += 1;
      s.bossSecSum += ft.boss.seconds;
      if (ft.boss.died) s.bossDeaths += 1;
    }
  });
  /* 判据 1：前 3 层存活率 = 完整清过 3 层（死在第 3 层算未存活） */
  if (r.clearedFloors >= 3) {
    agg.survival3 += 1;
    agg.time3N += 1;
    /* 判据 2：前 3 层的总战斗时长（只统计活过 F3 的样本，避免“死得早=更快”的偏差） */
    r.floorTrace.forEach((ft) => {
      if (ft.floor <= 3) agg.time3Sum += ft.clearSeconds;
    });
  }
  /* 判据 3：10 层通关率 */
  if (r.clearedFloors >= 10) agg.clear10 += 1;
  if (!r.died || r.deathFloor >= 20) agg.reach20 += 1;
  if (r.clearedFloors >= 20) agg.clear20 += 1;
  agg.runs += 1;
}

/**
 * 跑一个“角色 × 天赋”组合
 * @param {Object} ch 角色定义
 * @param {Object} tal 天赋档位
 * @param {number} runs 局数
 * @param {number} seed 基础种子
 * @returns {Object} 聚合结果
 */
function collect(ch, tal, runs, seed) {
  const agg = {
    runs: 0, survival3: 0, time3Sum: 0, time3N: 0,
    clear10: 0, reach20: 0, clear20: 0, floors: {}
  };
  for (let f = 1; f <= FLOORS; f += 1) {
    agg.floors[f] = { enter: 0, deaths: 0, clear: 0, bossFights: 0, bossSecSum: 0, bossDeaths: 0, causes: {} };
  }
  for (let i = 0; i < runs; i += 1) {
    const pf = PROFILE_MODE === 'bot' ? C.PROFILES.bot : C.PROFILES[IDS[i % 3]];
    const r = S.runOne(S.runSeed(seed, i), pf, 'normal', {
      charSpec: ch,
      talentSpec: tal
    });
    addRun(agg, r);
  }
  return agg;
}

/**
 * 把聚合结果整理成可读指标
 * @param {Object} a 聚合结果
 * @returns {Object} 指标
 */
function metricsOf(a) {
  const perFloor = {};
  for (let f = 1; f <= FLOORS; f += 1) {
    const s = a.floors[f];
    perFloor[f] = {
      enter: s.enter,
      deaths: s.deaths,
      deathRate: s.enter ? s.deaths / s.enter : null,
      causes: s.causes,
      bossFights: s.bossFights,
      bossSec: s.bossFights ? s.bossSecSum / s.bossFights : null,
      bossDeaths: s.bossDeaths
    };
  }
  /* 凹点：相邻层首领战平均时长下降 ≥ 3.0s 记一个凹点（3.1s 是现有最小凹点） */
  const dips = [];
  for (let f = 1; f < FLOORS; f += 1) {
    const a0 = perFloor[f].bossSec;
    const a1 = perFloor[f + 1].bossSec;
    if (a0 == null || a1 == null) continue;
    const delta = a1 - a0;
    if (delta <= -3.0) dips.push({ pair: `${f}→${f + 1}`, delta: +delta.toFixed(1) });
  }
  return {
    runs: a.runs,
    survival3: a.survival3,
    survival3Rate: a.survival3 / a.runs,
    time3Avg: a.time3N ? a.time3Sum / a.time3N : null,
    time3N: a.time3N,
    clear10: a.clear10,
    clear10Rate: a.clear10 / a.runs,
    reach20Rate: a.reach20 / a.runs,
    clear20Rate: a.clear20 / a.runs,
    perFloor,
    dips,
    dipCount: dips.length
  };
}

/**
 * 计算“面板”三件套（生命 / 伤害倍率 / 承伤倍率），用于双倍膨胀表
 * @param {Object} ch 角色
 * @param {Object} tal 天赋档位
 * @returns {Object} 面板
 */
function panelOf(ch, tal) {
  /* 起始生命 = 基础 × (1 + 角色百分比 + 天赋百分比) + 角色定点值（与 createPlayer 同口径） */
  const hp = Math.round(C.GAME.baseHp * (1 + (ch.hpPct || 0) + (tal.hpPct || 0)) + (ch.hpFlat || 0));
  const damage = (ch.techs || []).indexOf('amp') >= 0 ? 1.08 : 1;
  const taken = (ch.takenMul || 1) * ((ch.techs || []).indexOf('field') >= 0 ? 0.85 : 1);
  return {
    hp,
    damageMul: +(damage * tal.damageMul).toFixed(4),
    takenMul: +(taken * tal.takenMul).toFixed(4)
  };
}

/**
 * 主流程：跑主判据 + 天赋膨胀 + 打印
 * @returns {void}
 */
function main() {
  const opts = parseArgs();
  const out = { meta: { runs: opts.runs, talentRuns: opts.talentRuns, seed: C.SIM_PARAMS.baseSeed }, chars: {}, talent: {} };

  const charKeys = (opts.chars === 'all')
    ? Object.keys(CHARACTERS)
    : opts.chars.split(',').map((s) => s.trim()).filter((k) => CHARACTERS[k]);

  console.log('\n=== 主判据（每角色 ' + opts.runs + ' 局，普通档，seed ' + C.SIM_PARAMS.baseSeed + '）===');
  console.log('角色        样本   前3层存活率   前3层均时(s)   10层通关率   F20到达    F20通关   凹点数');
  charKeys.forEach((k) => {
    const ch = CHARACTERS[k];
    const agg = collect(ch, TALENTS.T0, opts.runs, C.SIM_PARAMS.baseSeed);
    const m = metricsOf(agg);
    out.chars[k] = m;
    console.log(
      pad(ch.label, 12) + pad(m.runs, 7)
      + pad((m.survival3Rate * 100).toFixed(2) + '%', 14)
      + pad(m.time3Avg == null ? '—' : m.time3Avg.toFixed(1), 15)
      + pad((m.clear10Rate * 100).toFixed(2) + '%', 12)
      + pad((m.reach20Rate * 100).toFixed(2) + '%', 10)
      + pad((m.clear20Rate * 100).toFixed(2) + '%', 10)
      + pad(m.dipCount, 7)
    );
  });

  console.log('\n=== 双倍膨胀：角色 × 天赋的面板 ===');
  console.log('角色        天赋档    生命   伤害倍率   承伤倍率');
  charKeys.forEach((k) => {
    Object.keys(TALENTS).forEach((t) => {
      if (k === 'base' && t !== 'T0') return;
      const p = panelOf(CHARACTERS[k], TALENTS[t]);
      if (!out.talent[k]) out.talent[k] = {};
      out.talent[k][t] = p;
      console.log(pad(CHARACTERS[k].label, 12) + pad(TALENTS[t].label, 10)
        + pad(p.hp, 9) + pad(p.damageMul.toFixed(3), 12) + pad(p.takenMul.toFixed(3), 10));
    });
  });

  console.log('\n=== 天赋满级后的 10 层通关率（每档 ' + opts.talentRuns + ' 局）===');
  console.log('角色        无天赋     tier1满    tier1+2满    全满');
  if (opts.talentRuns <= 0) {
    /* 只跑角色主判据时可关掉天赋档，省掉 5×N 局 */
    console.log('（--talent-runs 0：本段跳过）');
  }
  charKeys.forEach((k) => {
    if (k === 'base' || opts.talentRuns <= 0) return;
    const ch = CHARACTERS[k];
    const row = {};
    ['T0', 'T1', 'T2', 'T3', 'T3c'].forEach((t) => {
      const agg = collect(ch, TALENTS[t], opts.talentRuns, C.SIM_PARAMS.baseSeed);
      const m = metricsOf(agg);
      row[t] = { clear10: m.clear10Rate, survival3: m.survival3Rate, time3Avg: m.time3Avg, runs: m.runs };
    });
    if (!out.talentRuns) out.talentRuns = {};
    out.talentRuns[k] = row;
    console.log(pad(ch.label, 12) + pad((row.T0.clear10 * 100).toFixed(2) + '%', 10)
      + pad((row.T1.clear10 * 100).toFixed(2) + '%', 11)
      + pad((row.T2.clear10 * 100).toFixed(2) + '%', 12)
      + pad((row.T3.clear10 * 100).toFixed(2) + '%', 9)
      + pad((row.T3c.clear10 * 100).toFixed(2) + '%', 12));
  });

  console.log('\n=== 凹点明细（相邻层首领战均时下降，负值=变快）===');
  charKeys.forEach((k) => {
    const m = out.chars[k];
    const named = ['1→2', '2→3', '6→7', '11→12', '12→13'];
    const parts = [];
    named.forEach((pair) => {
      const i = Number(pair.split('→')[0]);
      const j = Number(pair.split('→')[1]);
      const a = m.perFloor[i].bossSec;
      const b = m.perFloor[j].bossSec;
      if (a != null && b != null) parts.push(pair + ' ' + (b - a).toFixed(1) + 's');
    });
    console.log(pad(CHARACTERS[k].label, 12) + '凹点 ' + m.dipCount + ' 个 | ' + parts.join(' / '));
  });

  /* 逐层表：证据留档（报告只摘录关键层） */
  console.log('\n=== 逐层（角色 / 进入 / 死亡 / 首领战均时）===');
  charKeys.forEach((k) => {
    const m = out.chars[k];
    console.log('--- ' + CHARACTERS[k].label + ' ---');
    for (let f = 1; f <= 19; f += 1) {
      const s = m.perFloor[f];
      console.log('F' + pad(f, 2) + pad(s.enter, 7) + pad(s.deaths, 6)
        + pad(s.deathRate == null ? '—' : (s.deathRate * 100).toFixed(2) + '%', 9)
        + pad(s.bossSec == null ? '—' : s.bossSec.toFixed(1), 8));
    }
  });

  const fs = require('fs');
  const path = require('path');
  const target = path.isAbsolute(opts.out) ? opts.out : path.join(__dirname, opts.out);
  fs.writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');
  console.log('\n产物: ' + target);
}

/**
 * 等宽补齐（控制台表格对齐用）
 * @param {*} v 值
 * @param {number} n 宽度
 * @returns {string} 补齐后的字符串
 */
function pad(v, n) {
  const s = String(v);
  let out = s;
  while (out.length < n) out += ' ';
  return out;
}

main();
