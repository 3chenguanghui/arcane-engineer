/**
 * 敌人密度 · 四口径验收（对齐主文件 minFloor=1 的尺子）
 * ------------------------------------------------------------
 * 用法：
 *   node 敌人数量-四口径验收.js --variant=e1 --runs=2000 --chars=all
 *   变体：base（无加密） e0（F1-5 不加） e1（F1-5 +1，F6+ +2） e2（F1-5 +2，F6+ +2）
 *   角色：all = 中性 / 守拙(104) / 疾火(95) / 观星(100)；base = 只跑中性
 *
 * 为什么必须先对齐：tools/sim_panel/sim.js 前五层仍是旧"教学档"
 * （×0.8 + F1 封顶 3），主文件已是 minFloor=1。不对齐的尺子会把 F1-5 测得更简单。
 * 本脚本每次都在临时副本里做两处替换（不改仓库原工具）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'tools', 'sim_panel');
const C = require(path.join(DIR, 'config.js'));

/**
 * 单次替换，命中数必须为 1
 * @param {string} src 源码
 * @param {string} from 原片段
 * @param {string} to 新片段
 * @param {string} tag 标签
 * @returns {string} 结果
 */
function once(src, from, to, tag) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`锚点[${tag}]命中 ${n} 次`);
  return src.replace(from, to);
}

// 变体参数
const VARIANTS = {
  base: null,
  e0: { earlyAdd: 0, lateAdd: 2, eliteAdd: 1, eliteMaxBase: 5, earlyUntil: 5, roomCap: 12 },
  e1: { earlyAdd: 1, lateAdd: 2, eliteAdd: 1, eliteMaxBase: 5, earlyUntil: 5, roomCap: 12 },
  e2: { earlyAdd: 2, lateAdd: 2, eliteAdd: 1, eliteMaxBase: 5, earlyUntil: 5, roomCap: 12 },
  // e3：前 5 层只加普通怪、精英不加（避免 F2/F4 精英房变成死亡墙）
  e3: { earlyAdd: 1, lateAdd: 2, eliteAdd: 1, eliteEarlyAdd: 0, eliteMaxBase: 5, earlyUntil: 5, roomCap: 12 },
  // e4：前 5 层完全不动，只从 F6 起加
  e4: { earlyAdd: 0, lateAdd: 2, eliteAdd: 1, eliteEarlyAdd: 0, eliteMaxBase: 5, earlyUntil: 5, roomCap: 12 },
  // e5：F1–2 完全不动（F2 是已经存在的死亡墙），F3–5 战斗房 +1，F6+ +2
  e5: { earlyAdd: 1, lateAdd: 2, eliteAdd: 1, eliteEarlyAdd: 0, eliteMaxBase: 5, earlyUntil: 5, noAddUntil: 2, roomCap: 12 }
};

/**
 * 构造"对齐 minFloor=1 + 可选密度"的模拟器副本
 * @param {Object|null} dens 密度配置（null = 不加）
 * @param {string} tag 变体名
 * @returns {string} 临时模块路径
 */
function buildSim(dens, tag) {
  let src = fs.readFileSync(path.join(DIR, 'sim.js'), 'utf8');
  src = once(src,
    `  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));
  if (floor <= C.ONBOARD.maxFloors) count = Math.round(count * C.ONBOARD.enemyCountMul);
  if (floor === 1) count = Math.min(C.ONBOARD.floor1CountCap, count);`,
    `  if (isElite && !budgetOn) count = Math.round(count * (tune && tune.countMul !== undefined ? tune.countMul : C.ELITE_ROOM.countMul));`,
    'onboard');
  src = once(src, '  const budgetOn = floor >= C.FLOOR_GEN.budgetFrom;', '  const budgetOn = true;', 'budgetFrom');
  if (dens) {
    src = once(src,
      '  count = Math.max(1, Math.min(cap, count));',
      `  count = Math.max(1, Math.min(cap, count));

  // 敌潮密度（模型口径：只加总量，不建模 wave）
  {
    const DD = ${JSON.stringify(dens)};
    if (isElite) {
      const ea = (floor <= DD.earlyUntil && DD.eliteEarlyAdd !== undefined) ? DD.eliteEarlyAdd : DD.eliteAdd;
      if (count <= DD.eliteMaxBase) count += ea;
    } else {
      const slow = DD.noAddUntil || 0;
      const ca = floor <= slow ? 0 : (floor <= DD.earlyUntil ? DD.earlyAdd : DD.lateAdd);
      count += ca;
    }
    count = Math.max(1, Math.min(DD.roomCap, count));
  }`,
      'density');
  }
  // 临时副本放在 .seedwork，require('./config') 要改成绝对路径，否则解析不到
  src = src.replace("require('./config')", `require(${JSON.stringify(path.join(DIR, 'config.js'))})`);
  const f = path.join(__dirname, '.seedwork', `.sim_enemy_${tag}.js`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, src, 'utf8');
  return f;
}

/* ─────────────────────────────────────────────────────────────
   选牌权重 growthBias —— **这是角色定位，不是可调参数，不要再讨论。**
   疾火 0.85：血 -5 / 奥能 +15 / 伤害 ×1.08，纯输出位
   中性 0.70：无加成，基准
   观星 0.70：生命不变、回复更快、**成长偏奥能**（aetherPerFloor 0.008），中庸偏攻
   守拙 0.45：血 +4%、成长偏生命，唯一防御位
   历史教训：曾把观星写成 0.55（比守拙只高 0.10），等于把"成长偏奥能"的角色
   当防御角色跑，单项虚增 5.8pp，并让观星半数结论失真。
   ───────────────────────────────────────────────────────────── */
/* 角色静态定义：**镜像主文件 CHARACTER_CONFIG.list**，只额外保留 growthBias（sim 专用选牌权重）。
   2026-11-09 补齐此前完全没进 sim 的四项：aetherFlat / aetherExtra / hpPerFloor / aetherPerFloor
   （主文件 charFlat + applyMetaStats 的口径；baseAether = 100、baseHp = 100）。
   仍与主文件不一致、此处刻意未动的：守拙/疾火的 magics（本命卡建模差异）。 */
const CHARS = {
  中性: {
    id: 'base', hpFlat: 0, hpPct: 0, magics: ['fireball', 'frost'],
    aetherFlat: 0, aetherExtra: 0, regenBonus: 0,
    growth: { hpPerFloor: 0, aetherPerFloor: 0 }, growthBias: null
  },
  守拙: {
    id: 'warden', hpFlat: 0, hpPct: 0.04, magics: ['flameCone', 'fireball'],
    aetherFlat: -10, aetherExtra: 0, regenBonus: 0,
    growth: { hpPerFloor: 0.012, aetherPerFloor: 0 },
    growthBias: { value: 0.45, survival: 0.55 }
  },
  疾火: {
    id: 'ember', hpFlat: -5, hpPct: 0, magics: ['fireball', 'blade'],
    aetherFlat: 15, aetherExtra: 10, regenBonus: 0, damageMul: 1.08,
    growth: { hpPerFloor: 0, aetherPerFloor: 0.012 },
    growthBias: { value: 0.85, survival: 0.15 }
  },
  观星: {
    id: 'gazer', hpFlat: 0, hpPct: 0, magics: ['fireball', 'frost'],
    aetherFlat: 5, aetherExtra: 0, regenBonus: 1,
    growth: { hpPerFloor: 0.004, aetherPerFloor: 0.008 },
    growthBias: { value: 0.70, survival: 0.30 }
  }
};

/**
 * 跑一个角色 N 局的通关率与死亡分布
 * @param {Object} S 模拟器模块
 * @param {number} runs 局数
 * @param {Object} charSpec 角色规格
 * @param {Object|null} [ashOv] 焚稿覆写；null=关闭，{enabled:true}=默认参数
 * @returns {Object} pass5 / pass10 / F20 / F2 死亡数 / 平均层数 / 焚稿使用统计
 */
function runSet(S, runs, charSpec, ashOv) {
  let c5 = 0; let c10 = 0; let f20 = 0;
  let floorSum = 0;
  let used = 0; let burnsSum = 0;
  const rites = { blast: 0, shield: 0, echo: 0 };
  let usedN = 0; let usedC10 = 0; let usedFloorSum = 0;
  let unusedN = 0; let unusedC10 = 0; let unusedFloorSum = 0;
  const deathFloor = {};
  const ov = { charSpec, talentSpec: null };
  if (ashOv) ov.ash = ashOv;
  for (let i = 0; i < runs; i += 1) {
    const r = S.runOne(S.runSeed(C.SIM_PARAMS.baseSeed, i), C.PROFILES.bot, 'normal', ov);
    const reached = r.died ? r.deathFloor : r.clearedFloors;
    floorSum += reached;
    if (r.clearedFloors >= 5) c5 += 1;
    if (r.clearedFloors >= 10) c10 += 1;
    if (r.clearedFloors >= 20 || (!r.died && r.clearedFloors >= C.SIM_PARAMS.maxFloor)) f20 += 1;
    if (r.died) deathFloor[r.deathFloor] = (deathFloor[r.deathFloor] || 0) + 1;
    if (ashOv) {
      const b = r.ashBurns || 0;
      burnsSum += b;
      Object.keys(rites).forEach((k) => { rites[k] += (r.ashRites && r.ashRites[k]) || 0; });
      if (b > 0) {
        used += 1; usedN += 1; usedFloorSum += reached;
        if (r.clearedFloors >= 10) usedC10 += 1;
      } else {
        unusedN += 1; unusedFloorSum += reached;
        if (r.clearedFloors >= 10) unusedC10 += 1;
      }
    }
  }
  const out = {
    pass5: +(c5 / runs * 100).toFixed(2),
    pass10: +(c10 / runs * 100).toFixed(2),
    f20: +(f20 / runs * 100).toFixed(2),
    f2Death: deathFloor[2] || 0,
    avgFloor: +(floorSum / runs).toFixed(2),
    deathFloor
  };
  if (ashOv) {
    out.ashUse = +(used / runs * 100).toFixed(2);
    out.avgBurns = +(burnsSum / runs).toFixed(2);
    out.rites = rites;
    out.usedN = usedN;
    out.unusedN = unusedN;
    out.usedAvgFloor = usedN ? +(usedFloorSum / usedN).toFixed(2) : null;
    out.unusedAvgFloor = unusedN ? +(unusedFloorSum / unusedN).toFixed(2) : null;
    out.strategyDiff = (usedN && unusedN)
      ? +((usedC10 / usedN - unusedC10 / unusedN) * 100).toFixed(2) : null;
  }
  return out;
}

(async () => {
  const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || d;
  const variant = arg('variant', 'e1');
  const runs = Number(arg('runs', 2000));
  const chars = arg('chars', 'all');
  const forge = arg('forge', 'on');
  /* 尺子已固定为角色定位（观星 0.70），此处仅留作临时对照，正常跑不要传 --gazer */
  const gazer = arg('gazer', '0.70');
  if (gazer !== '0.70') {
    CHARS.观星.growthBias = { value: Number(gazer), survival: +(1 - Number(gazer)).toFixed(2) };
    console.log('  观星 growthBias.value = ' + gazer + '（偏离已固定尺子，仅限对照）');
  }
  const gazerRegen = arg('gazer-regen', '1');
  if (gazerRegen !== '1') {
    /* 主文件观星 regenFlat 已是 1，尺子默认也对齐到 1；
       传 0 可验证"再砍一刀回能"的落地效果，传 2 可复现历史口径。 */
    CHARS.观星.regenBonus = Number(gazerRegen);
    console.log('  观星 regenBonus = ' + gazerRegen);
  }
  /* —— regen 0 的补偿实验旋钮（一次只开一项，2000 局/项）——
     背景：观星 regenFlat 1→0 后 F2 死亡 50→127，第二层暴毙代价过大。
     这三项都只作用观星，且都不改其他角色。
       --gazer-hpflat=N      ：起始生命 +N（主文件现成字段 hpFlat）
       --gazer-hpperfloor=N  ：逐层生命成长（主文件现成字段 growth.hpPerFloor）
       --gazer-takenmul=N    ：承伤乘区探针（**主文件无角色级字段，仅用于判断值不值得新增**）
     未传参数时全部保持原值，原路径零影响。 */
  const gazerHpFlat = arg('gazer-hpflat', null);
  if (gazerHpFlat != null) {
    CHARS.观星.hpFlat = Number(gazerHpFlat);
    console.log('  观星 hpFlat = ' + gazerHpFlat);
  }
  const gazerHpPerFloor = arg('gazer-hpperfloor', null);
  if (gazerHpPerFloor != null) {
    CHARS.观星.growth.hpPerFloor = Number(gazerHpPerFloor);
    console.log('  观星 hpPerFloor = ' + gazerHpPerFloor);
  }
  const gazerTakenMul = arg('gazer-takenmul', null);
  if (gazerTakenMul != null) {
    CHARS.观星.takenMul = Number(gazerTakenMul);
    console.log('  观星 takenMul = ' + gazerTakenMul + '（主文件无此字段，仅探针）');
  }
  if (forge === 'off') {
    /* B2-a 对照跑：关掉熔炉层计划，只保留原随机房型，用来隔离熔炉本身的影响 */
    C.ROOM.plan = {};
    console.log('  熔炉：off（F4 / F13 回退为随机房型）');
  }
  if (arg('legacy-char', '0') === '1') {
    /* 归因用：把所有角色的 aetherFlat / aetherExtra / 逐层成长归零，且池子设 0，
       复现"四项未接入"的旧尺子，用来量化模型修正本身贡献了多少 pp。 */
    Object.keys(CHARS).forEach((k) => {
      const c = CHARS[k];
      c.aetherFlat = 0; c.aetherExtra = 0;
      c.growth = { hpPerFloor: 0, aetherPerFloor: 0 };
    });
    /* 同时把"回能/生命/伤害"三项回退到历史尺子值，保证 legacy 能逐位复现旧基线 */
    CHARS.守拙.hpPct = 0; CHARS.守拙.hpFlat = 4; CHARS.守拙.regenBonus = 2;
    CHARS.疾火.damageMul = 1; CHARS.疾火.regenBonus = 4;
    CHARS.观星.regenBonus = 2;
    C.GAME.baseAether = 0;           // 池子上限归零 = 完全不参与供给
    console.log('  旧尺子：四项归零 + 回能/生命/伤害回退 + 奥能池关闭');
  }
  const dens = VARIANTS[variant];
  if (dens === undefined) throw new Error('未知变体：' + variant);

  const S = require(buildSim(dens, variant));
  const ashOn = arg('ash', 'off') === 'on';
  /* 焚稿参数覆写：默认沿用主文件 ASH_CONFIG；诊断时可单独关掉某一项做归因 */
  const ashOv = ashOn ? { enabled: true } : null;
  if (ashOv) {
    const numArg = (k) => { const v = arg(k, null); return v == null ? null : Number(v); };
    if (numArg('perstack') != null) ashOv.perStack = numArg('perstack');
    if (numArg('maxstacks') != null) ashOv.maxStacks = numArg('maxstacks');
    if (numArg('blast') != null) ashOv.blastRatio = numArg('blast');
    if (numArg('shield') != null) ashOv.shieldTime = numArg('shield');
    if (numArg('echo') != null) ashOv.echoCasts = numArg('echo');
    if (numArg('hpcost') != null) ashOv.hpCostPct = numArg('hpcost');   // 灰烬灼身：每层 -N% 有效生命
    console.log('  焚稿参数 ' + JSON.stringify(ashOv));
  }
  const list = chars === 'base' ? ['中性'] : (Object.prototype.hasOwnProperty.call(CHARS, chars) ? [chars] : Object.keys(CHARS));
  console.log(`[${variant}] 对齐 minFloor=1 ｜ 每口径 ${runs} 局 ｜ 档案 bot ｜ 焚稿 ${ashOn ? 'on' : 'off'}`);
  if (dens) console.log('  密度配置 ' + JSON.stringify(dens));
  console.log('  口径    通过5层%  通过10层%  到达20层%  F2死亡数  平均层数  焚稿使用%  平均焚稿  策略差pp');
  const results = {};
  list.forEach((n) => {
    const r = runSet(S, runs, CHARS[n], ashOv);
    results[n] = r;
    console.log('  ' + n.padEnd(6) + String(r.pass5).padStart(9) + String(r.pass10).padStart(11)
      + String(r.f20).padStart(11) + String(r.f2Death).padStart(9) + String(r.avgFloor).padStart(10)
      + (ashOn ? String(r.ashUse).padStart(11) + String(r.avgBurns).padStart(10) + String(r.strategyDiff).padStart(11) : ''));
    if (ashOn) {
      console.log('    仪式分布 ' + JSON.stringify(r.rites)
        + ` ｜ 烧过 ${r.usedN} 局均层 ${r.usedAvgFloor} / 没烧 ${r.unusedN} 局均层 ${r.unusedAvgFloor}`);
    }
  });
  // 落盘完整结果（含每层死亡分布）；文件名带局数与焚稿参数，避免不同批次互相覆盖
  /* 文件名带上全部焚稿参数：sh/bl/ec 任一不同都会落到不同文件，
     避免"强制单仪式"的 200 局 sanity 互相覆盖。 */
  const ashTag = ashOv
    ? `_ash_ps${ashOv.perStack == null ? 'def' : ashOv.perStack}_ms${ashOv.maxStacks == null ? 'def' : ashOv.maxStacks}`
      + `_hp${ashOv.hpCostPct == null ? 0 : ashOv.hpCostPct}_sh${ashOv.shieldTime == null ? 'def' : ashOv.shieldTime}`
      + `_bl${ashOv.blastRatio == null ? 'def' : ashOv.blastRatio}_ec${ashOv.echoCasts == null ? 'def' : ashOv.echoCasts}`
    : '';
  fs.writeFileSync(path.join(__dirname, `.seedwork`, `fourcal_${variant}_${runs}${ashTag}.json`),
    JSON.stringify({ variant, runs, dens: dens || null, ash: ashOv, results }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
