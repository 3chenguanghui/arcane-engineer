/**
 * P0 双卡红线探针：折跃步 riftStep + 霜封印 frostSeal
 * ----------------------------------------------------------------------------
 * 为什么要这样测（先说清，避免把估算当成实测）：
 *   1. 共享模拟器 tools/sim_panel/sim.js 的选卡器是**固定权重**（每张新魔法都给
 *      value 0.10 / survival 0.01，见 optionPool），并且**不认 minFloor**。
 *      往 C.MAGIC 里塞两张卡再跑，跑出来的差异只反映"多了两个固定分值的选项"，
 *      不反映两张卡真实的手感。那种数不能叫实测。
 *   2. 所以这里改测**上限**：假设玩家在第 4 层之后**必定拿到**这张卡，
 *      把它的收益折算成模拟器唯一能表达的同类旋钮 —— 承伤系数 charSpec.takenMul。
 *      上限口径 = 对红线最不利的情形。
 *   3. 再补一套**期望口径**：每张卡按 35% 获得率抽签（两张独立），
 *      没抽到就退回基线那一局的结果。用逐种子混样，不是拿百分比线性插值。
 *   4. 位移卡不占输出槽（主文件里它是替换位/第三槽），所以 DPS 收益按 0 计，
 *      属于**低估收益**（保守方向），不影响"会不会破线"的判断。
 *
 * 基线已按方案 A 降压（2026-11 标定，见 tools/baseline_tune.js）：
 *   · 全局：DIFFICULTY_CONFIG.modes.normal.damageMul 0.46 → 0.49
 *   · 观星：CHARACTER_CONFIG.list.gazer.regenFlat 2 → 1（等价 regenBonus 1.0）
 *   · 守拙 hpPct 0.04、疾火 damageMul 1.08 不动（角色身份保留）
 *   · config.js 的 normal.damageMul 已与主文件对齐到 0.49，探针不再做任何补偿乘法
 *   降压后四口径 10 层 34.1% / 36.4% / 35.9% / 36.4%，F20 30.0% / 32.1% / 31.7% / 32.0%
 *   （以上为 config.js 对齐到 damageMul 0.49 之后的数；口径头会实时打印，别手抄）。
 *
 * 口径换算（每个数都用覆盖率硬算，不拍脑袋）：
 *   原版卡：
 *     · 折跃步：0.25s 无敌 / 4.0s 冷却 = 6.25% 的接触窗口免疫 → takenMul ≈ 0.94
 *     · 霜封印：定身 0.9s / 3.0s 冷却 = 30% 的单体缴械；常规房按 3 只算 → 约 -10%，
 *               再按"只钉最近那只、其余照打"取保守值 → takenMul ≈ 0.96
 *     · 两张同带：0.94 × 0.96 ≈ 0.90
 *   冲刺候选（实际要落的削弱版）：
 *     · 折跃步：无敌 0.10s / 5.0s 冷却 = 2.0% → takenMul ≈ 0.98
 *     · 霜封印：定身 0.6s / 4.0s 冷却 ≈ 15% 单体缴械 → takenMul ≈ 0.985
 *     · 两张同带：0.98 × 0.985 ≈ 0.97
 *
 * 用法：node tools/p0_probe.js [--runs 2000]
 * 输出：四口径 × 各变体的 10 层通关率、F20 到达率，全部带样本数；
 *       另给"35% 获得率"混样口径的两张表。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const SIM = require(path.join(__dirname, 'sim_panel', 'sim.js'));
const C = require(path.join(__dirname, 'sim_panel', 'config.js'));

/**
 * 算文件 MD5（大写）。用途：四口径报告必须带模型指纹，
 * 避免"同一组参数两次跑出不同结论"——今天已经踩过一次（sim.js 被另一条线改过）。
 * @param {string} file 绝对路径
 * @returns {string} 32 位大写十六进制
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 读命令行 --runs（默认 2000）
 * @returns {number} 每个格子的局数
 */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 2000;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

/* 注意：这里**不再**有任何全局承伤补偿系数。
   config.js 的 normal.damageMul 已与主文件对齐（0.49），
   补偿系数留在代码里会让基线比线上更狠，属于"改了却没生效"同一族的问题，已删除。 */

/**
 * 四口径角色参数：**照抄主文件 CHARACTER_CONFIG**（L6905-L6944），
 * 只搬模拟器支持的三项（hpPct / hpFlat / damageMul / regenBonus / 起手卡）；
 * aetherFlat 与逐层生命/奥能成长模拟器不建模，这里如实标注不参与。
 * 观星 regenFlat 已按降压方案从 2 调到 1。
 */
const PROFILES = [
  { id: 'neutral', name: '中性',  spec: { magics: ['fireball', 'frost'] } },
  { id: 'warden',  name: '守拙',  spec: { hpPct: 0.04, magics: ['fireball', 'frost'] } },
  { id: 'ember',   name: '疾火',  spec: { hpFlat: -5, damageMul: 1.08, magics: ['fireball', 'frost'] } },
  { id: 'gazer',   name: '观星',  spec: { regenBonus: 1.0, magics: ['fireball', 'frost'] } }
];

/**
 * 各变体的承伤系数。越小 = 两张卡带来的承伤下降越多 = 对红线越不利。
 * 原版组用于"最坏情形"，削弱组用于"实际要落地的版本"。
 */
const VARIANTS = {
  base:   1.00,
  blink:  0.94,
  seal:   0.96,
  both:   0.90,
  strict: 0.86,
  blinkW: 0.98,
  sealW:  0.985,
  bothW:  0.97,
  /* 定稿参数（折跃步 4.0s 冷却 / 霜封印 3.0s 冷却）下的承伤系数：
     折跃步 0.10/4.0 = 2.5% → 0.975；霜封印 0.6/3.0 = 20% 单体缴械，按半算 → 0.98 */
  blinkS: 0.975,
  sealS:  0.98,
  bothS:  0.9555
};

const runs = readRuns();

/**
 * 跑一条序列：一个口径 × 一个承伤系数 × runs 局。
 * 返回逐种子的 0/1 数组，供"35% 获得率"逐局混样使用。
 * @param {Object} profile 口径
 * @param {number} takenMul 承伤系数
 * @returns {{f10: Uint8Array, f20: Uint8Array}} 逐局结果
 */
function runSeries(profile, takenMul) {
  const f10 = new Uint8Array(runs);
  const f20 = new Uint8Array(runs);
  for (let i = 0; i < runs; i += 1) {
    const seed = C.SIM_PARAMS.baseSeed + i;                 // 固定种子：同参可复现
    /* 承伤只听变体系数；全局难度由 config.js 的 normal.damageMul 直接表达 */
    const spec = Object.assign({}, profile.spec, { takenMul });
    const r = SIM.runOne(seed, C.PROFILES.bot, 'normal', { charSpec: spec });
    f10[i] = r.clearedFloors >= 10 ? 1 : 0;
    f20[i] = r.clearedFloors >= C.SIM_PARAMS.maxFloor ? 1 : 0;
  }
  return { f10, f20 };
}

/**
 * 统计一条序列的通关率。
 * @param {{f10: Uint8Array, f20: Uint8Array}} series 序列
 * @returns {{f10: number, f20: number, f10n: number, f20n: number, samples: number}}
 */
function rate(series) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < runs; i += 1) {
    a += series.f10[i];
    b += series.f20[i];
  }
  return { samples: runs, f10: a / runs, f20: b / runs, f10n: a, f20n: b };
}

/**
 * 逐局混样：两张卡各自按 rate 概率"抽到"。
 * 用哈希而不是线性插值，是因为插值会高估期望（通关率对承伤不是线性的）。
 * @param {Uint8Array} base 基线逐局结果
 * @param {Uint8Array} onlyA 只拿到 A（折跃步）
 * @param {Uint8Array} onlyB 只拿到 B（霜封印）
 * @param {Uint8Array} both 两张都拿到
 * @param {number} p 单卡获得率（0–1）
 * @returns {Uint8Array} 混样后的逐局结果
 */
function mixByAcquire(base, onlyA, onlyB, both, p) {
  const out = new Uint8Array(runs);
  const threshold = Math.round(p * 100);
  for (let i = 0; i < runs; i += 1) {
    const ra = hash01(i, 1) < threshold;   // 抽到折跃步
    const rb = hash01(i, 2) < threshold;   // 抽到霜封印
    if (ra && rb) out[i] = both[i];
    else if (ra) out[i] = onlyA[i];
    else if (rb) out[i] = onlyB[i];
    else out[i] = base[i];
  }
  return out;
}

/**
 * 由序号 + 盐位生成 0–99 的稳定散列值（不依赖 Math.random，保证可复现）。
 * @param {number} i 序号
 * @param {number} salt 盐位
 * @returns {number} 0–99
 */
function hash01(i, salt) {
  let h = (i * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h % 100;
}

const pad = (s, n) => String(s).padEnd(n, ' ');

/**
 * 打印一组表（5 个变体）。
 * @param {string} title 表头标题
 * @param {Array} rows 每行 {name, base, cells:[{label, r}]}
 */
function printGroup(title, rows) {
  console.log('\n' + title);
  console.log(pad('口径', 8) + pad('变体', 14) + pad('样本', 6)
    + pad('10层通关', 15) + pad('Δ10(pp)', 10) + pad('F20到达', 15) + 'Δ20(pp)');
  rows.forEach((row) => {
    const b10 = row.base.f10;
    const b20 = row.base.f20;
    row.cells.forEach((c, idx) => {
      const d10 = (c.r.f10 - b10) * 100;
      const d20 = (c.r.f20 - b20) * 100;
      console.log(
        pad(idx === 0 ? row.name : '', 8)
        + pad(c.label, 14)
        + pad(c.r.samples, 6)
        + pad((c.r.f10 * 100).toFixed(1) + '% (' + c.r.f10n + ')', 15)
        + pad(idx === 0 ? '—' : (d10 >= 0 ? '+' : '') + d10.toFixed(2), 10)
        + pad((c.r.f20 * 100).toFixed(1) + '% (' + c.r.f20n + ')', 15)
        + (idx === 0 ? '—' : (d20 >= 0 ? '+' : '') + d20.toFixed(2))
      );
    });
  });
}

/* 先把每个口径的 8 条序列都跑出来，后面三张表复用，不重复跑 */
const data = PROFILES.map((p) => {
  const s = {};
  Object.keys(VARIANTS).forEach((k) => { s[k] = runSeries(p, VARIANTS[k]); });
  return {
    name: p.name,
    base: rate(s.base),
    blink: rate(s.blink),
    seal: rate(s.seal),
    both: rate(s.both),
    strict: rate(s.strict),
    blinkW: rate(s.blinkW),
    sealW: rate(s.sealW),
    bothW: rate(s.bothW),
    blinkS: rate(s.blinkS),
    sealS: rate(s.sealS),
    bothS: rate(s.bothS),
    /* 35% 获得率两种口径（原版 / 定稿参数），逐局混样 */
    expOrig: rate({
      f10: mixByAcquire(s.base.f10, s.blink.f10, s.seal.f10, s.both.f10, 0.35),
      f20: mixByAcquire(s.base.f20, s.blink.f20, s.seal.f20, s.both.f20, 0.35)
    }),
    expShip: rate({
      f10: mixByAcquire(s.base.f10, s.blinkS.f10, s.sealS.f10, s.bothS.f10, 0.35),
      f20: mixByAcquire(s.base.f20, s.blinkS.f20, s.sealS.f20, s.bothS.f20, 0.35)
    })
  };
});

/* ---------- 口径头（强制）：模型指纹 + 基线四口径 + 样本数 ----------
   以后每份四口径报告顶部都必须有这三样，缺一样视为报告无效。
   指纹对不上 = 模型被改过，旧结论不能直接沿用。 */
const fpSim = md5Of(path.join(__dirname, 'sim_panel', 'sim.js'));
const fpCfg = md5Of(path.join(__dirname, 'sim_panel', 'config.js'));
const baseline10 = data.map((d) => (d.base.f10 * 100).toFixed(1)).join(' / ');
const baseline20 = data.map((d) => (d.base.f20 * 100).toFixed(1)).join(' / ');
console.log('【口径头】sim.js MD5 ' + fpSim + ' | config.js MD5 ' + fpCfg);
console.log('【口径头】基线含熔炉房 ON（G1）｜真·全关 = G0');
console.log('【口径头】样本 ' + runs + ' 局/格 | 口径顺序 中性/守拙/疾火/观星');
console.log('【口径头】G1 基线 10 层 ' + baseline10 + '% | G1 基线 F20 ' + baseline20 + '%');

/* 表 1：上限口径（原版卡，必定获得） */
printGroup('【表 1】上限口径 · 原版卡（假设 4 层后必定拿到）', data.map((d) => ({
  name: d.name,
  base: d.base,
  cells: [
    { label: '无新卡', r: d.base },
    { label: '只拿折跃步', r: d.blink },
    { label: '只拿霜封印', r: d.seal },
    { label: '两张同带', r: d.both },
    { label: '乐观上限', r: d.strict }
  ]
})));

/* 表 2：上限口径 · 削弱版卡（两个冷却版本对照） */
printGroup('【表 2】上限口径 · 削弱版卡（旧 5s·4s 冷却 vs 定稿 4s·3s 冷却）', data.map((d) => ({
  name: d.name,
  base: d.base,
  cells: [
    { label: '无新卡', r: d.base },
    { label: '折跃步 5s', r: d.blinkW },
    { label: '折跃步 4s', r: d.blinkS },
    { label: '霜封印 4s', r: d.sealW },
    { label: '霜封印 3s', r: d.sealS },
    { label: '同带 5s·4s', r: d.bothW },
    { label: '同带 4s·3s', r: d.bothS }
  ]
})));

/* 表 3：35% 获得率期望口径 */
printGroup('【表 3】期望口径 · 35% 获得率（逐局混样，非线性插值）', data.map((d) => ({
  name: d.name,
  base: d.base,
  cells: [
    { label: '无新卡', r: d.base },
    { label: '原版期望', r: d.expOrig },
    { label: '定稿期望', r: d.expShip }
  ]
})));

/* 判定表：门禁 = 10 层 ≤38.5% 且 F20 ≤35%（看最差口径） */
console.log('\n【判定】门禁：10 层 ≤38.5% 且 F20 ≤35%（取最差口径）');
const judgeRows = [
  { label: '上限·原版两张同带', key: 'both' },
  { label: '上限·削弱版同带 5s·4s', key: 'bothW' },
  { label: '上限·定稿同带 4s·3s', key: 'bothS' },
  { label: '期望·原版（35%）', key: 'expOrig' },
  { label: '期望·定稿（35%）', key: 'expShip' }
];
judgeRows.forEach((row) => {
  const worst10 = Math.max.apply(null, data.map((d) => d[row.key].f10));
  const worst20 = Math.max.apply(null, data.map((d) => d[row.key].f20));
  const ok = worst10 <= 0.385 && worst20 <= 0.35;
  console.log(pad(row.label, 26)
    + pad('最差10层 ' + (worst10 * 100).toFixed(1) + '%', 22)
    + pad('最差F20 ' + (worst20 * 100).toFixed(1) + '%', 22)
    + (ok ? 'PASS' : 'FAIL'));
});

console.log('\nJSON=' + JSON.stringify(data));
