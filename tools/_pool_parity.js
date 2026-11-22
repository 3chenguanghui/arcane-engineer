/**
 * 池结构 parity 检查（v1 两段池 vs 实机 index_arcane_v2.html）
 * ----------------------------------------------------------------------------
 * 目的：在重跑任何数之前，先证明「模拟器的池结构已经和实机一致」。
 *       5 条硬检查，任一 FAIL 直接以退出码 1 结束，禁止往下跑数。
 *
 * 5 条检查（对应用户要求）：
 *   P1 次数      —— 每条升级恰好 1 次技能段抽卡；每 3 级恰好 1 次被动段抽卡；
 *                   且 sim 的 skillCount/passiveEvery/passiveCount 与主文件常量逐项相等。
 *   P2 池 id 集合 —— 技能段只出 魔法/科技/融合，被动段只出 遗物，两池 id 集合互不相交。
 *   P3 选项数    —— 技能段每次 4 张、被动段每次 3 张（池子不够时按池量截断）。
 *   P4 遗物张数  —— 每局遗物张数 = 被动段抽卡次数（每次被动抽卡必得 1 张）。
 *   P5 基线脱钩  —— 新基线最差 10 层 / F20 不再与「混池 v0」的 35.9 / 27.5 在 2SE 内并列。
 *
 * 用法：
 *   node tools/_pool_parity.js                # 默认 n=400/口径，两变体
 *   node tools/_pool_parity.js --runs 800
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'sim_panel');
const C = require(path.join(DIR, 'config.js'));

const SIM_PATH = path.join(DIR, 'sim.js');
const LIVE_HTML = path.join(__dirname, '..', 'index_arcane_v2.html');
const V0_JSON = path.join(__dirname, '..', '.seedwork', 'draw_quota_4000_v0.json');

/**
 * 算文件 MD5（大写十六进制）
 * @param {string} file 绝对路径
 * @returns {string} 32 位大写十六进制
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 读命令行 --runs（默认 400）
 * @returns {number} 每口径局数
 */
function readRuns() {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 400;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 400;
}

/**
 * 单次字符串替换，命中数必须为 1，否则抛错（防止静默贴错锚点）
 * @param {string} src 源码
 * @param {string} from 原串
 * @param {string} to 新串
 * @returns {string} 替换后的源码
 */
function replaceOnce(src, from, to) {
  const hit = src.split(from).length - 1;
  if (hit !== 1) throw new Error('补丁锚点命中 ' + hit + ' 次（期望 1）：' + from.slice(0, 60));
  return src.replace(from, to);
}

/**
 * 生成带「抽卡日志」补丁的模拟器临时副本（只加观测，不改任何数值/抽取规则）
 * 日志字段：stage / poolSize / choices / chosen / chosenKind / empty
 * @returns {object} 模拟器模块
 */
function buildSim() {
  let src = fs.readFileSync(SIM_PATH, 'utf8');

  /* L1：每局挂一个日志容器 */
  src = replaceOnce(src,
    '  const p = createPlayer(profile, ov);',
    '  const p = createPlayer(profile, ov);\n  p.__drawLog = [];');

  /* L2：空池（抽卡被跳过）也记一条，用于校验「等级 − 抽卡次数」恒等式 */
  src = replaceOnce(src,
    '  if (!pool.length) return null;',
    '  if (!pool.length) {\n'
    + '    if (p.__drawLog) p.__drawLog.push({ stage: stage || \'skill\', empty: true });\n'
    + '    return null;\n'
    + '  }');

  /* L3：每次抽卡记录阶段、池量、候选与选中 */
  src = replaceOnce(src,
    '  if (stage !== \'passive\') p.level += 1;\n  if (rec) rec(',
    '  if (stage !== \'passive\') p.level += 1;\n'
    + '  if (p.__drawLog) {\n'
    + '    p.__drawLog.push({\n'
    + '      chosen: chosen && chosen.kind === \'magic\' ? chosen.id : null,\n'
    + '      chosenKind: chosen ? chosen.kind : \'other\',\n'
    + '      stage: stage || \'skill\',\n'
    + '      poolSize: pool.length,\n'
    + '      choices: choices.map((o) => ({ kind: o.kind, id: o.id }))\n'
    + '    });\n'
    + '  }\n'
    + '  if (rec) rec(');

  /* L4：结果带上日志 */
  src = replaceOnce(src,
    '  result.ashDeck = (p.deck || []).length;\n  return result;',
    '  result.ashDeck = (p.deck || []).length;\n  result.__drawLog = p.__drawLog || [];\n  return result;');

  src = src.replace("require('./config')", 'require(' + JSON.stringify(path.join(DIR, 'config.js')) + ')');

  const outDir = path.join(__dirname, '..', '.seedwork');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, '.sim_parity.js');
  fs.writeFileSync(outFile, src, 'utf8');
  delete require.cache[outFile];
  return require(outFile);
}

/**
 * 从主文件读出与「池结构」相关的常量，作为 parity 的唯一真值来源
 * @returns {object} {passiveEvery, passiveCount, skillCount, relicOnlyPassive, skillHasRelic}
 */
function readLiveConfig() {
  const html = fs.readFileSync(LIVE_HTML, 'utf8');
  const every = html.match(/passiveEvery:\s*(\d+)/);
  const pCount = html.match(/passiveCount:\s*(\d+)/);
  const rc = html.match(/REWARD_CHOICES_CONFIG = \{\s*enabled:\s*(true|false),\s*count:\s*(\d+)/);
  if (!every || !pCount || !rc) throw new Error('主文件里找不到池结构常量');
  /* 主文件两段分支的源码断言：passive 分支只 pushOption('relic'…)，skill 分支不出现 relic */
  const passiveBlock = html.slice(html.indexOf("if (rewardStage === 'passive') {"), html.indexOf('} else {', html.indexOf("if (rewardStage === 'passive') {")));
  const skillStart = html.indexOf('} else {', html.indexOf("if (rewardStage === 'passive') {"));
  const skillBlock = html.slice(skillStart, html.indexOf('// M2-1 精英路线', skillStart));
  return {
    passiveEvery: Number(every[1]),
    passiveCount: Number(pCount[1]),
    skillCount: rc[1] === 'true' ? Number(rc[2]) : 3,
    passiveOnlyRelic: passiveBlock.indexOf("pushOption('relic'") >= 0 && passiveBlock.indexOf("pushOption('magic'") < 0,
    skillHasNoRelic: skillBlock.indexOf("pushOption('relic'") < 0,
    skillKinds: ['magic', 'tech', 'pact', 'fusion']
  };
}

/**
 * 解析 v0（混池）基线数，用于 P5「不再并列」判定
 * @returns {object|null} {w10, w20, relicPerRun, drawsPerRun}
 */
function readV0() {
  if (!fs.existsSync(V0_JSON)) return null;
  const j = JSON.parse(fs.readFileSync(V0_JSON, 'utf8'));
  const b = j.modes && j.modes.ash006 && j.modes.ash006.base;
  if (!b) return null;
  return {
    w10: b.worst10.rate,
    w10se: b.worst10.se,
    w20: b.worst20.rate,
    w20se: b.worst20.se,
    relicPerRun: b.draw.pick.relic.rate,
    drawsPerRun: b.draw.draws.rate
  };
}

const PROFILES = [
  { name: '中性', spec: { magics: ['fireball', 'frost'] } },
  { name: '守拙', spec: { hpPct: 0.04, magics: ['fireball', 'frost'] } },
  { name: '疾火', spec: { hpFlat: -5, damageMul: 1.08, magics: ['fireball', 'frost'] } },
  { name: '观星', spec: { regenBonus: 1.0, magics: ['fireball', 'frost'] } }
];

/**
 * 比例与标准误（百分点）
 * @param {number[]} arr 0/1 数组
 * @returns {{rate:number, se:number}} rate/se 均为百分比
 */
function rateSe(arr) {
  const n = arr.length;
  const p = arr.reduce((s, x) => s + x, 0) / n;
  return { rate: p * 100, se: Math.sqrt(p * (1 - p) / n) * 100 };
}

/**
 * 跨局均值与标准误
 * @param {number[]} arr 每局一个数
 * @returns {{rate:number, se:number}} 均值与 SE
 */
function meanSe(arr) {
  const n = arr.length;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) { s += arr[i]; s2 += arr[i] * arr[i]; }
  const m = s / n;
  return { rate: m, se: Math.sqrt(Math.max(0, s2 / n - m * m) / n) };
}

/**
 * 跑一个变体：四口径 × runs 局，返回每局原始记录
 * @param {object} SIM 模拟器模块
 * @param {number} runs 每口径局数
 * @param {object} ashMode {ash: 焚稿配置}
 * @returns {object} per[profile] = {f10, f20, level, skillDraws, passiveDraws, relicSum, logs, skills4, passive3, ...}
 */
function runVariant(SIM, runs, ashMode) {
  const per = {};
  PROFILES.forEach((prof) => {
    const f10 = new Array(runs);
    const f20 = new Array(runs);
    const recs = new Array(runs);
    for (let i = 0; i < runs; i += 1) {
      const seed = C.SIM_PARAMS.baseSeed + i;
      const ov = { charSpec: Object.assign({}, prof.spec), ash: Object.assign({}, ashMode.ash) };
      const r = SIM.runOne(seed, C.PROFILES.bot, 'normal', ov);
      f10[i] = r.clearedFloors >= 10 ? 1 : 0;
      f20[i] = r.clearedFloors >= C.SIM_PARAMS.maxFloor ? 1 : 0;
      const log = r.__drawLog || [];
      let skillDraws = 0;
      let passiveDraws = 0;
      let emptySkill = 0;
      let emptyPassive = 0;
      let badSkillCount = 0;
      let badPassiveCount = 0;
      let skillHasRelic = 0;
      let passiveNonRelic = 0;
      let passivePicks = 0;
      log.forEach((e) => {
        if (e.empty) {
          if (e.stage === 'passive') emptyPassive += 1; else emptySkill += 1;
          return;
        }
        if (e.stage === 'passive') {
          passiveDraws += 1;
          if (e.choices.length !== Math.min(C.SIM_PARAMS.passiveCount || 3, e.poolSize)) badPassiveCount += 1;
          if (e.choices.some((c) => c.kind !== 'relic')) passiveNonRelic += 1;
          if (e.chosenKind === 'relic') passivePicks += 1;
          return;
        }
        skillDraws += 1;
        if (e.choices.length !== Math.min(C.SIM_PARAMS.skillCount || 4, e.poolSize)) badSkillCount += 1;
        if (e.choices.some((c) => c.kind === 'relic')) skillHasRelic += 1;
      });
      const relicSum = Object.keys(r.relics || {}).reduce((s, k) => s + r.relics[k], 0);
      recs[i] = {
        level: r.level, skillDraws, passiveDraws, emptySkill, emptyPassive,
        badSkillCount, badPassiveCount, skillHasRelic, passiveNonRelic, passivePicks, relicSum
      };
    }
    per[prof.name] = { f10, f20, recs };
  });
  return per;
}

/**
 * 最差口径的通关率（4 口径取最高，即闸门最差档）及该口径名
 * @param {object} per runVariant 的 per
 * @param {string} key 'f10' | 'f20'
 * @returns {{rate:number, se:number, profile:string}} 最差档
 */
function worstOf(per, key) {
  let best = null;
  PROFILES.forEach((p) => {
    const v = rateSe(per[p.name][key]);
    if (!best || v.rate > best.rate) best = { rate: v.rate, se: v.se, profile: p.name };
  });
  return best;
}

/* ---------------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------------- */
const runs = readRuns();
const live = readLiveConfig();
const v0 = readV0();
const ashHpMatch = fs.readFileSync(LIVE_HTML, 'utf8').match(/hpCostPct:\s*([0-9.]+)/);
const ashHp = ashHpMatch ? Number(ashHpMatch[1]) : 0.06;

const MODES = [
  { key: 'ash006', label: '焚稿 0.06 线上', ash: { enabled: true, hpCostPct: ashHp } },
  { key: 'noash', label: '无焚稿', ash: { enabled: false } }
];

const SIM = buildSim();
const results = [];
MODES.forEach((mode) => {
  const t0 = Date.now();
  const per = runVariant(SIM, runs, mode);
  results.push({ mode, per });
  process.stdout.write('  [' + mode.label + '] 跑完 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's\n');
});

const L = [];
/**
 * 同时写控制台与内存行缓冲
 * @param {string} s 一行文本
 * @returns {void}
 */
function say(s) {
  L.push(s);
  console.log(s);
}

const checks = [];
/**
 * 注册一条 parity 检查结果
 * @param {string} id 编号（P1…P5）
 * @param {string} name 名称
 * @param {boolean} pass 是否通过
 * @param {string} detail 证据/数值
 * @returns {void}
 */
function check(id, name, pass, detail) {
  checks.push({ id, name, pass, detail });
}

say('');
say('══════════════════════════════════════════════════════════════════');
say('【池结构 parity】sim ' + md5Of(SIM_PATH) + '｜config ' + md5Of(path.join(DIR, 'config.js')));
say('主文件 ' + md5Of(LIVE_HTML) + '｜n=' + runs + ' 局/口径 × 4 口径 × 2 变体');
say('══════════════════════════════════════════════════════════════════');

/* ---- P1 次数 ---- */
{
  const cfgMatch = C.SIM_PARAMS.skillCount === live.skillCount
    && C.SIM_PARAMS.passiveEvery === live.passiveEvery
    && C.SIM_PARAMS.passiveCount === live.passiveCount;
  let badSkill = 0;
  let badPassive = 0;
  let badLevel = 0;
  let totalSkill = 0;
  let totalPassive = 0;
  let totalEmpty = 0;
  results.forEach(({ per }) => {
    PROFILES.forEach((p) => {
      per[p.name].recs.forEach((r) => {
        totalSkill += r.skillDraws;
        totalPassive += r.passiveDraws;
        totalEmpty += r.emptySkill + r.emptyPassive;
        if (r.skillDraws + r.emptySkill !== r.level - 1) badLevel += 1;
        if (r.passiveDraws !== Math.floor(r.level / live.passiveEvery)) badPassive += 1;
      });
    });
  });
  const pass = cfgMatch && badLevel === 0 && badPassive === 0;
  check('P1', '次数（每级1次技能段 / 每3级1次被动段 + 常量同源）', pass,
    '常量 sim(' + C.SIM_PARAMS.skillCount + '/' + C.SIM_PARAMS.passiveEvery + '/' + C.SIM_PARAMS.passiveCount
    + ') vs 主文件(' + live.skillCount + '/' + live.passiveEvery + '/' + live.passiveCount + ')'
    + '｜技能段抽卡合计 ' + totalSkill + ' 次 / 被动段 ' + totalPassive + ' 次 / 空池跳过 ' + totalEmpty + ' 次'
    + '｜恒等式违例：等级 ' + badLevel + ' / 被动 ' + badPassive);
}

/* ---- P2 池 id 集合 ---- */
{
  const relicIds = Object.keys(C.RELIC);
  const magicIds = C.MAGIC.map((m) => m.id);
  const techIds = Object.keys(C.TECH);
  const fusionIds = C.FUSION.map((f) => f.id);
  const fresh = {
    magics: ['fireball', 'frost'], techs: {}, fusions: {}, hasHeal: false,
    relics: {}, level: 1, profile: C.PROFILES.bot, deck: [], hp: 100, hpMax: 100
  };
  const skill = SIM.optionPool(fresh, 'skill');
  const passive = SIM.optionPool(fresh, 'passive');
  const skillKinds = Array.from(new Set(skill.map((o) => o.kind)));
  const skillBadKind = skill.filter((o) => o.kind !== 'magic' && o.kind !== 'tech' && o.kind !== 'fusion');
  const skillRelicHit = skill.filter((o) => relicIds.indexOf(o.id) >= 0);
  const skillIdMiss = skill.filter((o) => {
    if (o.kind === 'magic') return magicIds.indexOf(o.id) < 0;
    if (o.kind === 'tech') return techIds.indexOf(o.id) < 0;
    if (o.kind === 'fusion') return fusionIds.indexOf(o.id) < 0;
    return true;
  });
  const passiveBadKind = passive.filter((o) => o.kind !== 'relic');
  const passiveIdMiss = passive.filter((o) => relicIds.indexOf(o.id) < 0);
  /* 遗物池随已持有层数收缩：把第一件遗物堆满后它应从池里消失 */
  const r0 = relicIds[0];
  const full = Object.assign({}, fresh, { relics: { [r0]: C.RELIC[r0].maxStacks || 3 } });
  const passiveFull = SIM.optionPool(full, 'passive');
  const shrinkOk = passive.length === relicIds.length && passiveFull.length === relicIds.length - 1;

  let skillRelicInLog = 0;
  let passiveNonRelicInLog = 0;
  results.forEach(({ per }) => {
    PROFILES.forEach((p) => {
      per[p.name].recs.forEach((r) => {
        skillRelicInLog += r.skillHasRelic;
        passiveNonRelicInLog += r.passiveNonRelic;
      });
    });
  });

  const pass = live.passiveOnlyRelic && live.skillHasNoRelic
    && skillBadKind.length === 0 && skillRelicHit.length === 0 && skillIdMiss.length === 0
    && passiveBadKind.length === 0 && passiveIdMiss.length === 0 && shrinkOk
    && skillRelicInLog === 0 && passiveNonRelicInLog === 0;
  check('P2', '池 id 集合（技能段=魔法/科技/融合，被动段=遗物，互不相交）', pass,
    '技能池 ' + skill.length + ' 项 [' + skillKinds.join('+') + ']，被动池 ' + passive.length + ' 项（全遗物）'
    + '｜越界：技能段含遗物 ' + (skillRelicHit.length + skillRelicInLog) + ' 次，被动段含非遗物 ' + (passiveBadKind.length + passiveNonRelicInLog) + ' 次'
    + '｜满层遗物出池 ' + (shrinkOk ? 'OK' : 'FAIL')
    + '｜主文件：passive 只遗物=' + live.passiveOnlyRelic + '，skill 无遗物=' + live.skillHasNoRelic);
}

/* ---- P3 选项数 ---- */
{
  let badSkill = 0;
  let badPassive = 0;
  let skillN = 0;
  let passiveN = 0;
  results.forEach(({ per }) => {
    PROFILES.forEach((p) => {
      per[p.name].recs.forEach((r) => {
        badSkill += r.badSkillCount;
        badPassive += r.badPassiveCount;
        skillN += r.skillDraws;
        passiveN += r.passiveDraws;
      });
    });
  });
  const cfgMatch = C.SIM_PARAMS.skillCount === live.skillCount
    && C.SIM_PARAMS.passiveCount === live.passiveCount;
  const pass = cfgMatch && badSkill === 0 && badPassive === 0;
  check('P3', '选项数（技能段 4 / 被动段 3）', pass,
    '技能段 ' + (C.SIM_PARAMS.skillCount || 4) + ' 张、被动段 ' + (C.SIM_PARAMS.passiveCount || 3) + ' 张'
    + '｜违例：技能段 ' + badSkill + '/' + skillN + '，被动段 ' + badPassive + '/' + passiveN
    + '（池量不足时按 min(选项数, 池量) 截断）');
}

/* ---- P4 遗物张数 ---- */
{
  let mismatch = 0;
  let zeroRelic = 0;
  const relicPerRun = [];
  const passivePerRun = [];
  results.forEach(({ per }) => {
    PROFILES.forEach((p) => {
      per[p.name].recs.forEach((r) => {
        relicPerRun.push(r.relicSum);
        passivePerRun.push(r.passiveDraws);
        if (r.relicSum !== r.passiveDraws) mismatch += 1;
        if (r.relicSum <= 0) zeroRelic += 1;
      });
    });
  });
  const rel = meanSe(relicPerRun);
  const pas = meanSe(passivePerRun);
  const pass = mismatch === 0 && zeroRelic === 0;
  check('P4', '遗物张数（每局遗物 = 被动段抽卡次数）', pass,
    '遗物 ' + rel.rate.toFixed(2) + '±' + rel.se.toFixed(2) + ' 张/局，被动段 ' + pas.rate.toFixed(2) + '±' + pas.se.toFixed(2) + ' 次/局'
    + '｜不等 ' + mismatch + ' 局，零遗物 ' + zeroRelic + ' 局'
    + (v0 ? '｜混池 v0 对照：遗物 ' + v0.relicPerRun.toFixed(2) + ' 张/局' : ''));
}

/* ---- P5 基线脱钩 ---- */
{
  const rows = results.map(({ mode, per }) => {
    const w10 = worstOf(per, 'f10');
    const w20 = worstOf(per, 'f20');
    return { mode, w10, w20 };
  });
  const main = rows[0];
  const d10 = v0 ? Math.abs(main.w10.rate - v0.w10) : NaN;
  const d20 = v0 ? Math.abs(main.w20.rate - v0.w20) : NaN;
  const se10 = v0 ? Math.sqrt(main.w10.se * main.w10.se + v0.w10se * v0.w10se) : NaN;
  const se20 = v0 ? Math.sqrt(main.w20.se * main.w20.se + v0.w20se * v0.w20se) : NaN;
  const pass = !!v0 && d10 > 2 * se10 && d20 > 2 * se20;
  check('P5', '基线脱钩（最差10层 / F20 不再与 35.9 / 27.5 并列）', pass,
    v0
      ? main.mode.label + '：' + main.w10.rate.toFixed(1) + '%±' + main.w10.se.toFixed(1)
        + '（' + main.w10.profile + '）/ ' + main.w20.rate.toFixed(1) + '%±' + main.w20.se.toFixed(1)
        + '（' + main.w20.profile + '） vs 混池 v0 35.9/27.5 → Δ ' + d10.toFixed(1) + '（' + (2 * se10).toFixed(1)
        + ' 阈值）/ ' + d20.toFixed(1) + '（' + (2 * se20).toFixed(1) + ' 阈值）'
      : '缺少 v0 档案 ' + V0_JSON + '，无法判定'
  );
  say('');
  say('—— 新基线（v1 两段池，n=' + runs + '/口径）——');
  say('| 变体 | 最差10层 | F20 | 分母 |');
  say('|---|---|---|---|');
  rows.forEach((r) => {
    say('| ' + r.mode.label + ' | ' + r.w10.rate.toFixed(1) + '%±' + r.w10.se.toFixed(1) + '%（' + r.w10.profile + '） | '
      + r.w20.rate.toFixed(1) + '%±' + r.w20.se.toFixed(1) + '%（' + r.w20.profile + '） | '
      + runs + ' 局/口径 × 4 口径 |');
  });
}

say('');
say('—— parity 结果 ——');
say('| 检查 | 结论 | 证据 |');
say('|---|---|---|');
checks.forEach((c) => {
  say('| ' + c.id + ' ' + c.name + ' | ' + (c.pass ? 'PASS' : 'FAIL') + ' | ' + c.detail + ' |');
});

const allPass = checks.every((c) => c.pass);
say('');
say(allPass ? '【结论】5 条 parity 全过，允许往下跑数。' : '【结论】parity 未过，按约定禁止往下跑数。');

const outFile = path.join(__dirname, '..', '.seedwork', 'pool_parity_' + runs + '.json');
fs.writeFileSync(outFile, JSON.stringify({
  ts: new Date().toISOString(),
  runs,
  fingerprints: { sim: md5Of(SIM_PATH), config: md5Of(path.join(DIR, 'config.js')), html: md5Of(LIVE_HTML) },
  live, v0, checks, allPass
}, null, 2));
const logDir = path.join(__dirname, '..', '_archive', '20261109');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'pool_parity_' + runs + '.log');
fs.writeFileSync(logFile, L.join('\n') + '\n', 'utf8');
console.log('\n【存档】' + outFile);
console.log('【存档】' + logFile);

process.exit(allPass ? 0 : 1);
